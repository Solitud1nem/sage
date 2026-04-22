/**
 * Agent-related types for the Sage protocol.
 *
 * Chain-agnostic — no EVM/Solana/NEAR-specific assumptions.
 * Adapters map these to chain-native representations.
 */

/** Opaque agent identifier. On EVM this is an EOA address; on other chains it may differ. */
export type AgentId = string & { readonly __brand: 'AgentId' };

/** Creates a branded AgentId from a raw string. */
export function agentId(raw: string): AgentId {
  return raw as AgentId;
}

/** Machine-readable capability tag exposed by an agent (e.g. "summarize", "translate"). */
export type Capability = string & { readonly __brand: 'Capability' };

/** Creates a branded Capability from a raw string. */
export function capability(raw: string): Capability {
  return raw as Capability;
}

/** On-chain agent record as stored in the AgentRegistry. */
export interface AgentRecord {
  /** Owner/identifier of the agent. */
  readonly id: AgentId;
  /** HTTP(S) or IPFS endpoint where the agent is reachable. */
  readonly endpoint: string;
  /** Unix timestamp (seconds) when the agent was registered. */
  readonly registeredAt: number;
  /** Whether the agent is currently active (not paused). */
  readonly active: boolean;
}

/** Rich agent profile data, stored off-chain via EAS attestations on Base. */
export interface AgentProfile {
  /** Agent identifier (same as AgentRecord.id). */
  readonly id: AgentId;
  /** Human-readable display name. */
  readonly displayName: string;
  /** Short description of what the agent does. */
  readonly description: string;
  /** List of capabilities the agent offers. */
  readonly capabilities: readonly Capability[];
  /** Pricing information per capability. */
  readonly pricing: readonly PricingEntry[];
  /** Semantic version of the agent software. */
  readonly version: string;
}

/** A single pricing entry: capability → price. */
export interface PricingEntry {
  readonly capability: Capability;
  readonly pricePerCall: PriceSpec;
  readonly pricePerTask: PriceSpec;
}

// PriceSpec is defined in payment.ts but referenced here for AgentProfile.
// Re-exported from the barrel (types/index.ts).
import type { PriceSpec } from './payment.js';
export type { PriceSpec } from './payment.js';
