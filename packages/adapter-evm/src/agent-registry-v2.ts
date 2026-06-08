/**
 * EVM adapter for AgentRegistryV2 (per M11.2).
 *
 * Same identity-anchor pattern as v1 (ADR-0002) but with capability + price
 * + rich-profile fields. Returns `AgentClientV2`; v1 `createAgentRegistryClient`
 * remains the choice for legacy v1 registries.
 *
 * The V2 contract is deployed at the `sage:registry:v2` salt on Base
 * mainnet + Sepolia. Same anchor pattern: spoke chains don't get their
 * own registry, the SDK verifies against Base.
 */

import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';
import type {
  AgentClientV2,
  AgentId,
  AgentRecordV2,
  ListAgentsOptions,
  ListAgentsResultV2,
  RegistryCapability,
} from '@sage/core';
import { agentId, capability } from '@sage/core';
import { agentRegistryV2Abi } from './abi/index.js';

type BoundWalletClient = WalletClient<Transport, Chain, Account>;

/**
 * Fetch all active agents from a V2 registry. Walks paginated `listAgents`
 * with a default page size (50) until exhausted. Filters out inactive
 * agents — discovery skips them.
 *
 * Read-only — does not require a wallet client. Pass `publicClient` only.
 * Returns an empty array on a registry with no agents.
 */
export async function listActiveAgentsV2(
  publicClient: PublicClient,
  registryAddress: `0x${string}`,
  options: { pageSize?: number; maxAgents?: number } = {},
): Promise<AgentRecordV2[]> {
  const pageSize = options.pageSize ?? 50;
  const maxAgents = options.maxAgents ?? 1000;

  const collected: AgentRecordV2[] = [];
  let cursor = 0n;

  while (collected.length < maxAgents) {
    const result = await publicClient.readContract({
      address: registryAddress,
      abi: agentRegistryV2Abi,
      functionName: 'listAgents',
      args: [cursor, BigInt(pageSize)],
    });

    const [rawAgents, nextCursor] = result;
    if (rawAgents.length === 0) break;

    for (const a of rawAgents) {
      if (!a.active) continue;
      collected.push({
        id: agentId(a.owner),
        endpoint: a.endpoint,
        profileUri: a.profileUri,
        capabilities: a.capabilities.map(decodeCapability),
        registeredAt: Number(a.registeredAt),
        active: a.active,
      });
    }

    if (nextCursor === 0n) break;
    cursor = nextCursor;
  }

  return collected;
}

/** Convert a viem-decoded capability tuple into the SDK shape. */
function decodeCapability(raw: { name: string; price: bigint }): RegistryCapability {
  return {
    name: capability(raw.name),
    price: raw.price,
  };
}

/** Convert an SDK capability to the on-chain tuple the V2 ABI expects. */
function encodeCapability(c: RegistryCapability): { name: string; price: bigint } {
  return { name: c.name, price: c.price };
}

export function createAgentRegistryV2Client(
  publicClient: PublicClient,
  walletClient: BoundWalletClient,
  registryAddress: `0x${string}`,
): AgentClientV2 {
  return {
    async registerAgent({ endpoint, profileUri, capabilities }) {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'registerAgent',
        args: [endpoint, profileUri, capabilities.map(encodeCapability)],
      });
    },

    async updateEndpoint(endpoint) {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'updateEndpoint',
        args: [endpoint],
      });
    },

    async updateProfileUri(profileUri) {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'updateProfileUri',
        args: [profileUri],
      });
    },

    async updateCapabilities(capabilities) {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'updateCapabilities',
        args: [capabilities.map(encodeCapability)],
      });
    },

    async pauseAgent() {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'pauseAgent',
      });
    },

    async resumeAgent() {
      return walletClient.writeContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'resumeAgent',
      });
    },

    async getAgent(id: AgentId): Promise<AgentRecordV2 | null> {
      const result = await publicClient.readContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'getAgent',
        args: [id as `0x${string}`],
      });

      if (result.owner === '0x0000000000000000000000000000000000000000') {
        return null;
      }

      return {
        id: agentId(result.owner),
        endpoint: result.endpoint,
        profileUri: result.profileUri,
        capabilities: result.capabilities.map(decodeCapability),
        registeredAt: Number(result.registeredAt),
        active: result.active,
      };
    },

    async listAgents(options: ListAgentsOptions): Promise<ListAgentsResultV2> {
      const result = await publicClient.readContract({
        address: registryAddress,
        abi: agentRegistryV2Abi,
        functionName: 'listAgents',
        args: [BigInt(options.cursor), BigInt(options.limit)],
      });

      const [rawAgents, nextCursor] = result;

      const agents: AgentRecordV2[] = rawAgents.map((a) => ({
        id: agentId(a.owner),
        endpoint: a.endpoint,
        profileUri: a.profileUri,
        capabilities: a.capabilities.map(decodeCapability),
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
