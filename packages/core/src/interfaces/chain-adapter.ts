/**
 * Top-level chain adapter interface.
 *
 * Each supported chain (EVM, Solana, NEAR) provides an implementation
 * that bundles AgentClient + TaskClient + chain metadata.
 */

import type { AgentClient } from './agent-client.js';
import type { TaskClient } from './task-client.js';

/** Metadata about a supported chain. */
export interface ChainInfo {
  /** Unique chain identifier (e.g. EVM chainId, Solana cluster name). */
  readonly chainId: string;
  /** Human-readable chain name (e.g. "Base", "Solana Mainnet"). */
  readonly name: string;
  /** Block explorer URL, if available. */
  readonly explorerUrl: string | null;
}

/**
 * Unified chain adapter — the main entry point for interacting
 * with Sage protocol on a specific chain.
 *
 * Adapters are created via chain-specific factory functions
 * (e.g. `createSageClient()` in @sage/adapter-evm).
 */
export interface ChainAdapter {
  /** Information about the connected chain. */
  readonly chain: ChainInfo;

  /** Agent registry operations. */
  readonly agents: AgentClient;

  /** Task escrow operations. */
  readonly tasks: TaskClient;
}
