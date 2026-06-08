/**
 * Chain-agnostic interface for the V2 agent-registry surface (per M11.2).
 *
 * Adds capability + price + rich-profile fields on top of the v1
 * `AgentClient`. `registerAgent` / `updateProfile` from v1 are replaced by
 * a richer register shape and three granular update methods (endpoint /
 * profileUri / capabilities). `getAgent` returns an `AgentRecordV2`.
 *
 * Adapters that target a v2 registry (e.g. `@sage/adapter-evm`
 * `createAgentRegistryV2Client`) return this interface. The v1 `AgentClient`
 * is preserved for legacy registries.
 */

import type { AgentId, AgentRecordV2, RegistryCapability } from '../types/agent.js';
import type { ListAgentsOptions } from './agent-client.js';

/** Result of a paginated v2 agent listing. */
export interface ListAgentsResultV2 {
  readonly agents: readonly AgentRecordV2[];
  readonly nextCursor: number | null;
}

export interface AgentClientV2 {
  /**
   * Register the caller as a new agent.
   * @param params.endpoint Non-empty URI where the agent is reachable.
   * @param params.profileUri Optional rich-profile URI (empty string clears).
   * @param params.capabilities Capability list with per-task prices. Empty
   *        array registers identity-only — discovery skips the agent.
   * @returns Transaction hash.
   */
  registerAgent(params: {
    endpoint: string;
    profileUri: string;
    capabilities: readonly RegistryCapability[];
  }): Promise<string>;

  /** Update only the endpoint URI. */
  updateEndpoint(endpoint: string): Promise<string>;

  /** Update only the profileUri. Empty string clears it. */
  updateProfileUri(profileUri: string): Promise<string>;

  /** Replace the capability list entirely. Pass empty array to remove all. */
  updateCapabilities(capabilities: readonly RegistryCapability[]): Promise<string>;

  /** Pause the caller's agent. */
  pauseAgent(): Promise<string>;

  /** Resume the caller's agent. */
  resumeAgent(): Promise<string>;

  /** Read the v2 record. Null if not registered. */
  getAgent(id: AgentId): Promise<AgentRecordV2 | null>;

  /** Paginated listing. */
  listAgents(options: ListAgentsOptions): Promise<ListAgentsResultV2>;
}
