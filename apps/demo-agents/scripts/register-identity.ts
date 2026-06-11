/**
 * Register (or resume) a generic-worker identity in AgentRegistryV2
 * (M12.0.4). Idempotent — mirrors the foreign-agent template's
 * ensureRegistered: already-registered + active → no-op; registered but
 * paused → resumeAgent; absent → registerAgent.
 *
 *   CHAIN=mainnet RPC_URL=… COPYWRITER_PRIVATE_KEY=0x… \
 *   pnpm --filter @sage/demo-agents exec tsx scripts/register-identity.ts \
 *     copywriter copywrite 30000
 *
 * Args: <identity-id> <capability> <priceUnits> [endpoint]
 * Endpoint defaults to the production worker app — an http(s) endpoint is
 * what opts the identity into orchestrator wake-pings (M12.0.2).
 *
 * RUN THIS ONLY WHEN THE IDENTITY'S HANDLER IS LIVE (see
 * docs/research/pipeline-economics.md §5): a registered capability without a
 * handler routes real escrow into the void — the classifier picks cheapest
 * by capability name and nothing will ever accept the task.
 */

/* eslint-disable no-console -- CLI tool: stdout is the interface */
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, nonceManager } from 'viem';
import { base as baseChainDef, baseSepolia as baseSepoliaChainDef } from 'viem/chains';
import { agentId, capability as capBrand } from '@sage/core';
import { base, baseSepolia, createAgentRegistryV2Client } from '@sage/adapter-evm';

const [id, capabilityName, priceRaw, endpointArg] = process.argv.slice(2);
if (!id || !capabilityName || !priceRaw || !/^\d+$/.test(priceRaw)) {
  console.error('usage: tsx scripts/register-identity.ts <identity-id> <capability> <priceUnits> [endpoint]');
  process.exit(1);
}
const priceUnits = BigInt(priceRaw);
const endpoint = endpointArg ?? 'https://sage-workers.fly.dev';

const CHAIN = process.env['CHAIN'];
if (CHAIN !== 'mainnet' && CHAIN !== 'sepolia') {
  // Same explicit-only posture as the worker runtime (GOTCHAS: silent Sepolia).
  console.error('Set CHAIN=mainnet or CHAIN=sepolia explicitly.');
  process.exit(1);
}
const sageChain = CHAIN === 'sepolia' ? baseSepolia : base;
const viemChain = CHAIN === 'sepolia' ? baseSepoliaChainDef : baseChainDef;
const rpcUrl = process.env['RPC_URL'] ?? sageChain.rpc;

const envName = `${id.toUpperCase().replace(/-/g, '_')}_PRIVATE_KEY`;
const pk = process.env[envName];
if (!pk) {
  console.error(`Missing ${envName} in env.`);
  process.exit(1);
}

const registryAddr = sageChain.contracts.agentRegistryV2;
if (!registryAddr) {
  console.error(`Chain "${CHAIN}" has no agentRegistryV2 configured.`);
  process.exit(1);
}

async function main(): Promise<void> {
  const account = privateKeyToAccount(pk as `0x${string}`, { nonceManager });
  const publicClient = createPublicClient({ chain: viemChain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpcUrl) });
  type RegistryArgs = Parameters<typeof createAgentRegistryV2Client>;
  const registry = createAgentRegistryV2Client(
    publicClient as RegistryArgs[0],
    walletClient,
    registryAddr!,
  );

  console.log(`identity ${id} → ${account.address} (chain ${CHAIN})`);

  let existing = null;
  try {
    existing = await registry.getAgent(agentId(account.address));
  } catch {
    // unregistered → getAgent reverts
  }
  if (existing && existing.capabilities.some((c) => c.name === capabilityName)) {
    if (!existing.active) {
      console.log('registered but paused — resuming…');
      const h = await registry.resumeAgent();
      await publicClient.waitForTransactionReceipt({ hash: h as `0x${string}` });
      console.log(`resumed (tx ${h})`);
    } else {
      console.log('already registered + active — no-op');
    }
    return;
  }

  console.log(`registering "${capabilityName}" @ ${priceUnits} units, endpoint ${endpoint}…`);
  const hash = await registry.registerAgent({
    endpoint,
    profileUri: '',
    capabilities: [{ name: capBrand(capabilityName), price: priceUnits }],
  });
  await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  console.log(`registered (tx ${hash})`);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
