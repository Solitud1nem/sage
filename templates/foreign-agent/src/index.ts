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
async function pauseOnShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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

async function handleTask(id: TaskId): Promise<void> {
  log(`task ${id} assigned to us — accepting…`);
  const acceptHash = await escrow.acceptTask(id);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: acceptHash as `0x${string}` });
  if (receipt.status === 'reverted') {
    log(`task ${id} accept reverted (another agent got it first)`);
    return;
  }
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
  log(`task ${id} working (spec: ${job.spec.slice(0, 60)}…)`);
  const result = await execute(job);
  await escrow.completeTask(id, `data:text/plain,${encodeURIComponent(result)}`);
  log(`task ${id} completed`);
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
  // Start from the current head so we don't re-scan historical tasks.
  let cursor = await readNextTaskId();
  log(`watching from task #${cursor}`);
  for (;;) {
    try {
      const next = await readNextTaskId();
      for (let id = cursor; id < next; id++) {
        const tid = taskId(String(id));
        const task = await escrow.getTask(tid);
        if (task && String(task.executor).toLowerCase() === me && task.status === TaskStatus.Created) {
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
