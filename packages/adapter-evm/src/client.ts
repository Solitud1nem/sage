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
import { createAgentRegistryClient } from './agent-registry.js';
import { createTaskEscrowClient } from './task-escrow.js';

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

  return {
    chain: chainInfo,
    agents,
    tasks,
  };
}
