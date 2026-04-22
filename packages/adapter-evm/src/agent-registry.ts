import type { PublicClient, WalletClient } from 'viem';
import type { AgentId, AgentRecord } from '@sage/core';
import type { AgentClient, ListAgentsOptions, ListAgentsResult } from '@sage/core';
import { agentId } from '@sage/core';
import { agentRegistryAbi } from './abi/index.js';

export function createAgentRegistryClient(
  publicClient: PublicClient,
  walletClient: WalletClient,
  registryAddress: `0x${string}`,
): AgentClient {
  return {
    async registerAgent({ endpoint }) {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'registerAgent',
        args: [endpoint],
      });
      return hash;
    },

    async updateProfile({ endpoint }) {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'updateProfile',
        args: [endpoint],
      });
      return hash;
    },

    async pauseAgent() {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'pauseAgent',
      });
      return hash;
    },

    async resumeAgent() {
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'resumeAgent',
      });
      return hash;
    },

    async getAgent(id: AgentId): Promise<AgentRecord | null> {
      const result = await publicClient.readContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'getAgent',
        args: [id as `0x${string}`],
      });

      const [owner, endpoint, registeredAt, active] = [
        result.owner,
        result.endpoint,
        Number(result.registeredAt),
        result.active,
      ];

      if (owner === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        id: agentId(owner),
        endpoint,
        registeredAt,
        active,
      };
    },

    async listAgents(options: ListAgentsOptions): Promise<ListAgentsResult> {
      const result = await publicClient.readContract({
        address: registryAddress,
        abi: agentRegistryAbi,
        functionName: 'listAgents',
        args: [BigInt(options.cursor), BigInt(options.limit)],
      });

      const [rawAgents, nextCursor] = result;

      const agents: AgentRecord[] = rawAgents.map((a) => ({
        id: agentId(a.owner),
        endpoint: a.endpoint,
        registeredAt: Number(a.registeredAt),
        active: a.active,
      }));

      return {
        agents,
        nextCursor: nextCursor === 0n ? null : Number(nextCursor),
      };
    },
  };
}
