/**
 * Arc chain entry for Sage web UI.
 *
 * Status: planned. Arc is testnet-only at time of writing (2026-05-21);
 * the placeholder values here track `packages/adapter-arc/src/chain.ts`
 * and exist so the UI can surface "Arc — coming when testnet stabilises"
 * without committing to a fake chainId or a fake explorer URL.
 *
 * Once `@sage/adapter-arc` ships a real implementation (Arc testnet
 * chainId + RPC + explorer confirmed, ERC-8183 + ERC-8004 ABIs wired),
 * this file flips `status` to `'live'` and the chainId / rpcUrl /
 * explorer placeholders get real values. The SageChainConfig fields
 * for live EVM chains (`contracts`, `x402FacilitatorDefault`) are
 * intentionally omitted from the planned shape — they describe
 * primitives Sage deploys onto a chain, but Arc does not get our
 * `TaskEscrow` / `AgentRegistry` (per ADR-0014).
 */

export interface PlannedChainConfig {
  /** Always `'planned'` for entries in this file. */
  readonly status: 'planned';
  /** Short identifier (matches `name` field on live chains). */
  readonly name: string;
  /** Human-readable name surfaced in UI badges, table rows, etc. */
  readonly displayName: string;
  /** Block explorer base URL — placeholder until Arc testnet publishes. */
  readonly explorer: string | null;
  /**
   * Free-form note rendered in tooltips / sub-text. Keep terse — UI
   * surfaces this verbatim. Updated when the blocking condition shifts.
   */
  readonly note: string;
  /**
   * Path or URL to the ADR or runbook documenting the planned-state
   * decision. Components can link from a status pill to context.
   */
  readonly adr: string;
}

/**
 * Arc — sibling chain to Base via `@sage/adapter-arc` over native
 * ERC-8183 + ERC-8004 (per ADR-0014). Not active in any wallet flow
 * yet; surfaced in `/docs/architecture` chain table as Planned.
 */
export const ARC: PlannedChainConfig = {
  status: 'planned',
  name: 'arc',
  displayName: 'Arc',
  explorer: 'https://testnet.arcscan.app',
  note: 'Coming when Arc testnet stabilises. Native ERC-8183 + ERC-8004 wrapper, not a TaskEscrow deploy.',
  adr: 'docs/adr/0014-arc-adapter-native-erc-8183.md',
};

/**
 * Planned chains surfaced in UI alongside `SAGE_CHAINS`. Keyed by
 * `name` (not chainId — these don't have one yet). Components that
 * need to render "all chains, live + planned" iterate over both.
 */
export const SAGE_PLANNED_CHAINS: Readonly<Record<string, PlannedChainConfig>> = {
  arc: ARC,
};
