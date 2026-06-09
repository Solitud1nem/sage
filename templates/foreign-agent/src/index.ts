/**
 * Foreign agent runtime.
 *
 * A self-contained, forkable Sage worker that a third-party operator runs on
 * their own infrastructure with their own wallet. On boot it self-registers in
 * AgentRegistryV2 (if not already registered), then polls TaskEscrow for tasks
 * assigned to its address, accepts them, runs the pluggable handler, and
 * submits the result on-chain. Nothing here is Sage-team-specific — it talks
 * only to the public `@sage/adapter-evm` SDK and the deployed contracts.
 *
 * Discovery uses direct `nextTaskId` polling rather than `watchContractEvent`
 * (viem event watchers are unreliable on some RPCs — see the demo workers'
 * task-poller). One sponsor-side createTask → at most a ~15s detection lag.
 */

import { createServer } from 'node:http';
import { createPublicClient, createWalletClient, http, nonceManager } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base as baseChainDef, baseSepolia as baseSepoliaChainDef } from 'viem/chains';
import { TaskStatus, agentId, taskId, capability, type TaskId } from '@sage/core';
import {
  base,
  baseSepolia,
  createTaskEscrowV2Client,
  createAgentRegistryV2Client,
  taskEscrowV2Abi,
} from '@sage/adapter-evm';

import { execute } from './handler.js';

// ── Config ──────────────────────────────────────────────────────────────────

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const CHAIN = process.env['CHAIN'] === 'sepolia' ? 'sepolia' : 'mainnet';
const sageChain = CHAIN === 'sepolia' ? baseSepolia : base;
const viemChain = CHAIN === 'sepolia' ? baseSepoliaChainDef : baseChainDef;
const rpcUrl = required('RPC_URL');
const capabilityName = capability(required('CAPABILITY'));
const priceUnits = BigInt(required('PRICE_UNITS'));
const endpoint = process.env['ENDPOINT'] ?? 'https://example.com/foreign-agent';
const port = Number(process.env['PORT'] ?? 3010);

// ── Safety guards ──────────────────────────────────────────────────────────
// The loop will accept ANY task routed to this address, including ones created
// outside the Sage classifier with hostile economics (1-unit pay, megabyte
// payloads, near-past deadlines). These bounds keep a forked agent from burning
// gas/LLM spend on work it can't profitably complete. Defaults are conservative;
// operators tune via env.
const minTaskUnits = BigInt(process.env['MIN_TASK_UNITS'] ?? priceUnits.toString());
const minDeadlineMarginS = Number(process.env['MIN_DEADLINE_MARGIN_S'] ?? 120);
const maxMaterialChars = Number(process.env['MAX_MATERIAL_CHARS'] ?? 100_000);
const bootScanBack = Number(process.env['BOOT_SCAN_BACK'] ?? 200);
const handlerRetries = Number(process.env['HANDLER_RETRIES'] ?? 2);

const registryAddr = sageChain.contracts.agentRegistryV2;
if (!registryAddr) {
  throw new Error(`Chain "${CHAIN}" has no agentRegistryV2 configured — cannot register.`);
}

const account = privateKeyToAccount(required('PRIVATE_KEY') as `0x${string}`, { nonceManager });
const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });

// The adapter clients want viem's un-specialized PublicClient / wallet types;
// our chain-specialized instances are structurally compatible, so we pin the
// parameter types to satisfy the compiler without `any`.
type EscrowArgs = Parameters<typeof createTaskEscrowV2Client>;
type RegistryArgs = Parameters<typeof createAgentRegistryV2Client>;
const escrow = createTaskEscrowV2Client(
  publicClient as EscrowArgs[0],
  walletClient as EscrowArgs[1],
  sageChain.contracts.taskEscrow,
  sageChain.contracts.usdc,
);
const registry = createAgentRegistryV2Client(
  publicClient as RegistryArgs[0],
  walletClient as RegistryArgs[1],
  registryAddr,
);

const me = account.address.toLowerCase();
const log = (msg: string) => console.error(`[foreign-agent] ${msg}`);

// ── Minimal composite-envelope decode (ADR-0018) ──────────────────────────────
// Inlined so the template stays self-contained. Mirrors the worker-side codec.

const ENVELOPE_PREFIX = 'data:application/json,';

function decodeJob(specUri: string): { spec: string; material: string | null } {
  if (!specUri.startsWith(ENVELOPE_PREFIX)) {
    // 3-mode / raw path: the whole specUri is the content.
    return { spec: specUri, material: specUri };
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(specUri.slice(ENVELOPE_PREFIX.length))) as {
      spec?: unknown;
      source?: unknown;
      inputs?: Record<string, unknown>;
    };
    const spec = typeof parsed.spec === 'string' ? parsed.spec : specUri;
    let material: string | null = null;
    if (parsed.inputs && typeof parsed.inputs === 'object') {
      const parts = Object.keys(parsed.inputs)
        .map(Number)
        .filter((n) => Number.isInteger(n))
        .sort((a, b) => a - b)
        .map((k) => parsed.inputs![String(k)])
        .filter((v): v is string => typeof v === 'string');
      if (parts.length > 0) material = parts.join('\n\n');
    }
    if (material === null && typeof parsed.source === 'string') material = parsed.source;
    return { spec, material };
  } catch {
    return { spec: specUri, material: null };
  }
}

// ── Self-registration (idempotent) ────────────────────────────────────────────

async function ensureRegistered(): Promise<void> {
  let existing = null;
  try {
    existing = await registry.getAgent(agentId(account.address));
  } catch {
    // getAgent reverts / returns nothing for an unregistered address.
  }
  if (existing && existing.capabilities.some((c) => c.name === capabilityName)) {
    // Already registered. If we paused ourselves on a prior shutdown, resume so
    // the classifier can pick us again.
    if (!existing.active) {
      log('registered but paused — resuming…');
      const h = await registry.resumeAgent();
      await publicClient.waitForTransactionReceipt({ hash: h as `0x${string}` });
      log('resumed (active)');
    } else {
      log(`already registered + active for "${capabilityName}" — skipping`);
    }
    return;
  }
  log(`registering for "${capabilityName}" at ${priceUnits} units…`);
  const hash = await registry.registerAgent({
    endpoint,
    profileUri: '',
    capabilities: [{ name: capabilityName, price: priceUnits }],
  });
  await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  log(`registered (tx ${hash})`);
}

/**
 * Pause our registry entry on shutdown so a stopped/redeploying agent does not
 * black-hole its capability: `pauseAgent` sets active=false, and the Sage
 * classifier only picks active agents — so tasks fall back to another provider.
 * Best-effort + bounded (the host's kill timeout may cut it short on a hard
 * kill); a crashed agent that can't pause is recovered by your restart policy.
 */
let shuttingDown = false;
/** True while a task is between acceptTask and completeTask — see drain below. */
let inFlight = false;
async function pauseOnShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  // Drain an in-flight task first (bounded): a task accepted but not yet
  // completed would otherwise strand the client's escrow until its deadline.
  // The host's kill timeout caps how long we get; if it cuts us off, the task
  // stays Accepted and your restart policy / the deadline recovers it.
  const drainDeadline = Date.now() + 25_000;
  while (inFlight && Date.now() < drainDeadline) {
    log('waiting for in-flight task to finish before pausing…');
    await sleep(1000);
  }
  log(`${signal} — pausing registry entry…`);
  try {
    const h = await registry.pauseAgent();
    await publicClient.waitForTransactionReceipt({ hash: h as `0x${string}` });
    log('paused — safe to stop');
  } catch (e) {
    log(`pause-on-shutdown failed (continuing to exit): ${e}`);
  }
  process.exit(0);
}
process.on('SIGINT', () => void pauseOnShutdown('SIGINT'));
process.on('SIGTERM', () => void pauseOnShutdown('SIGTERM'));

// ── Task loop ─────────────────────────────────────────────────────────────────

/**
 * Decide whether to take a task BEFORE spending gas on acceptTask. The task
 * record (amount, deadline) is already in hand from the poll, so every reject
 * here is free. Returns a reason string to skip, or null to proceed.
 */
function rejectReason(amount: bigint, deadline: number): string | null {
  if (amount < minTaskUnits) {
    return `pays ${amount} < MIN_TASK_UNITS ${minTaskUnits}`;
  }
  const now = Math.floor(Date.now() / 1000);
  if (deadline <= now + minDeadlineMarginS) {
    return `deadline in ${deadline - now}s < MIN_DEADLINE_MARGIN_S ${minDeadlineMarginS}`;
  }
  return null;
}

/** Run the handler, retrying on transient failure up to HANDLER_RETRIES. */
async function executeWithRetry(job: { spec: string; material: string | null }): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= handlerRetries; attempt++) {
    try {
      return await execute(job);
    } catch (e) {
      lastErr = e;
      if (attempt < handlerRetries) {
        const backoff = 2000 * (attempt + 1);
        log(`handler attempt ${attempt + 1} failed (${e}) — retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

async function handleTask(id: TaskId): Promise<void> {
  log(`task ${id} assigned to us — accepting…`);
  const acceptHash = await escrow.acceptTask(id);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: acceptHash as `0x${string}` });
  if (receipt.status === 'reverted') {
    log(`task ${id} accept reverted (another agent got it first)`);
    return;
  }
  // From here the client's escrow is committed to us — guard the rest with
  // inFlight so a shutdown drains it instead of stranding the escrow.
  inFlight = true;
  try {
    // Bounded wait for the Accepted state to be readable before reading specUri.
    let task = await escrow.getTask(id);
    for (let i = 0; i < 5 && task?.status !== TaskStatus.Accepted; i++) {
      await sleep(2000);
      task = await escrow.getTask(id);
    }
    if (!task) {
      log(`task ${id} not readable — skipping`);
      return;
    }
    const job = decodeJob(task.specUri);
    // Cap the material so a hostile payload can't inflate the handler's cost.
    if (maxMaterialChars > 0 && job.material && job.material.length > maxMaterialChars) {
      log(`task ${id} material ${job.material.length} chars — truncating to ${maxMaterialChars}`);
      job.material = job.material.slice(0, maxMaterialChars);
    }
    log(`task ${id} working (spec: ${job.spec.slice(0, 60)}…)`);
    const result = await executeWithRetry(job);
    const completeHash = await escrow.completeTask(id, `data:text/plain,${encodeURIComponent(result)}`);
    const completeReceipt = await publicClient.waitForTransactionReceipt({
      hash: completeHash as `0x${string}`,
    });
    if (completeReceipt.status === 'reverted') {
      log(`task ${id} completeTask reverted — task stays Accepted, leaving for retry/deadline`);
      return;
    }
    log(`task ${id} completed (tx ${completeHash})`);
  } finally {
    inFlight = false;
  }
}

async function readNextTaskId(): Promise<number> {
  const n = await publicClient.readContract({
    address: sageChain.contracts.taskEscrow,
    abi: taskEscrowV2Abi,
    functionName: 'nextTaskId',
  });
  return Number(n);
}

async function pollLoop(): Promise<void> {
  const head = await readNextTaskId();
  // Scan back from the head so tasks created while we were offline (deploys,
  // crashes) aren't missed. Re-scanning is safe: the executor+Created filter
  // skips anything we already handled (a completed task is no longer Created).
  let cursor = bootScanBack > 0 ? Math.max(0, head - bootScanBack) : head;
  log(`watching from task #${cursor} (head ${head}, scan-back ${bootScanBack})`);
  for (;;) {
    try {
      const next = await readNextTaskId();
      for (let id = cursor; id < next; id++) {
        const tid = taskId(String(id));
        const task = await escrow.getTask(tid);
        if (task && String(task.executor).toLowerCase() === me && task.status === TaskStatus.Created) {
          const reason = rejectReason(task.amount, task.deadline);
          if (reason) {
            log(`task ${id} skipped — ${reason}`);
            continue;
          }
          await handleTask(tid).catch((e) => log(`task ${id} error: ${e}`));
        }
      }
      cursor = next;
    } catch (e) {
      log(`poll error (will retry): ${e}`);
    }
    await sleep(15_000);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Boot ──────────────────────────────────────────────────────────────────────

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', address: account.address, capability: capabilityName }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}).listen(port, () => log(`health on :${port} — address ${account.address}`));

async function main(): Promise<void> {
  await ensureRegistered();
  await pollLoop();
}

main().catch((e) => {
  log(`fatal: ${e}`);
  process.exit(1);
});
