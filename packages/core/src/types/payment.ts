/**
 * Payment-related types for the Sage protocol.
 *
 * Chain-agnostic — no EVM-specific token addresses or ABI types.
 */

/** Supported payment methods in the Sage protocol. */
export enum PaymentMethod {
  /** Task-level escrow via TaskEscrow contract. For multi-step tasks. */
  Escrow = 'Escrow',
  /** Pay-per-call via x402 HTTP payment protocol. For single-shot calls. */
  X402 = 'X402',
  /** Direct ERC-20 transfer with permit. Escape-hatch when x402 is unavailable. */
  Direct = 'Direct',
}

/** Token identifier. Chain-agnostic — adapters resolve to native address. */
export type TokenSymbol = 'USDC';

/** Price specification for a service. */
export interface PriceSpec {
  /** Amount in smallest token unit (e.g. 1_000_000 = 1 USDC). */
  readonly amount: bigint;
  /** Token used for payment. v2.0: always USDC. */
  readonly token: TokenSymbol;
  /** Currency for display purposes (always USD in v2.0). */
  readonly currency: 'USD';
}
