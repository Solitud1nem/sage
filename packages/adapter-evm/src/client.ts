/**
 * Main entry point for the Sage EVM adapter.
 *
 * Usage:
 *   import { createSageClient, baseSepolia } from '@sage/adapter-evm';
 *
 *   const sage = createSageClient({
 *     chain: baseSepolia,
 *     walletClient,
 *     publicClient,
 *   });
 *
 *   await sage.agents.registerAgent({ endpoint: 'https://my-agent.com' });
 *   const taskId = await sage.tasks.createTask({ ... });
 */

import type { PublicClient, WalletClient } from 'viem';
import type { ChainAdapter, ChainInfo, AgentClient, TaskClient } from '@sage/core';
import type { ChainConfig } from './chains/base.js';
import type { X402Client } from './x402.js';
import type { PayDirectClient } from './pay-direct.js';
import { createAgentRegistryClient } from './agent-registry.js';
import { createTaskEscrowClient } from './task-escrow.js';
import { createX402Client } from './x402.js';
import { createPayDirectClient } from './pay-direct.js';

export interface CreateSageClientOptions {
  /** Chain configuration (e.g. baseSepolia, base). */
  chain: ChainConfig;
  /** viem WalletClient with account for signing transactions. */
  walletClient: WalletClient;
  /** viem PublicClient for reading chain state. */
  publicClient: PublicClient;
}

export interface SageClient extends ChainAdapter {
  readonly chain: ChainInfo;
  readonly agents: AgentClient;
  readonly tasks: TaskClient;
  /** x402 pay-per-call client. Call agent endpoints with automatic payment. */
  readonly x402: X402Client;
  /** Direct ERC-20 transfer escape-hatch. Prefer x402 or escrow. */
  readonly pay: PayDirectClient;
}

export function createSageClient(options: CreateSageClientOptions): SageClient {
  const { chain, walletClient, publicClient } = options;

  const chainInfo: ChainInfo = {
    chainId: chain.chainId.toString(),
    name: chain.name,
    explorerUrl: chain.explorer,
  };

  const agents = createAgentRegistryClient(
    publicClient,
    walletClient,
    chain.contracts.agentRegistry,
  );

  const tasks = createTaskEscrowClient(
    publicClient,
    walletClient,
    chain.contracts.taskEscrow,
    chain.contracts.usdc,
  );

  const account = walletClient.account;
  const chainNetwork = `eip155:${chain.chainId}`;

  const x402 = account
    ? createX402Client(account, chainNetwork)
    : ({ callAgent: () => { throw new Error('x402 requires walletClient with account'); } } as X402Client);

  const pay = createPayDirectClient(publicClient, walletClient);

  return {
    chain: chainInfo,
    agents,
    tasks,
    x402,
    pay,
  };
}
