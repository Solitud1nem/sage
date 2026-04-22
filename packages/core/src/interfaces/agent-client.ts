/**
 * Chain-agnostic interface for agent registry operations.
 *
 * Adapters (EVM, Solana, NEAR) implement this interface
 * to provide chain-specific agent management.
 */

import type { AgentId, AgentRecord } from '../types/agent.js';

/** Options for paginated agent listing. */
export interface ListAgentsOptions {
  /** Cursor position for pagination (0-based index). */
  readonly cursor: number;
  /** Maximum number of agents to return. */
  readonly limit: number;
}

/** Result of a paginated agent listing. */
export interface ListAgentsResult {
  /** List of agent records for this page. */
  readonly agents: readonly AgentRecord[];
  /** Next cursor value, or null if no more pages. */
  readonly nextCursor: number | null;
}

/** Agent registry operations. Implemented by chain-specific adapters. */
export interface AgentClient {
  /**
   * Register a new agent in the registry.
   * @param endpoint - HTTP(S) or IPFS endpoint where the agent is reachable.
   * @returns The transaction hash (chain-specific format).
   */
  registerAgent(params: { endpoint: string }): Promise<string>;

  /**
   * Update the endpoint of an existing agent.
   * @returns The transaction hash.
   */
  updateProfile(params: { endpoint: string }): Promise<string>;

  /**
   * Pause the caller's agent (set inactive).
   * @returns The transaction hash.
   */
  pauseAgent(): Promise<string>;

  /**
   * Resume the caller's agent (set active).
   * @returns The transaction hash.
   */
  resumeAgent(): Promise<string>;

  /**
   * Get the on-chain record for a specific agent.
   * @returns The agent record, or null if not registered.
   */
  getAgent(id: AgentId): Promise<AgentRecord | null>;

  /**
   * List active agents with cursor-based pagination.
   */
  listAgents(options: ListAgentsOptions): Promise<ListAgentsResult>;
}
