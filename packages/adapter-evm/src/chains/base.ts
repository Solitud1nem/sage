/**
 * Sage chain configuration. Shared across all EVM chains the adapter
 * supports. Base mainnet + Base Sepolia define the canonical shape;
 * additional chains (Arc per ADR-0015) may omit fields that don't
 * apply to them — `eas`, `easSchemaRegistry`, `createX`, and
 * `x402FacilitatorDefault` are optional for that reason.
 */

export interface ChainConfig {
  readonly chainId: number;
  readonly name: string;
  readonly rpc: string;
  readonly explorer: string;
  readonly contracts: {
    readonly agentRegistry: `0x${string}`;
    readonly taskEscrow: `0x${string}`;
    readonly usdc: `0x${string}`;
    /** EAS attestation contract — present on Base + OP-stack chains; absent on Arc. */
    readonly eas?: `0x${string}`;
    /** EAS schema registry — pairs with `eas`. Same availability. */
    readonly easSchemaRegistry?: `0x${string}`;
    /** CreateX factory (`0xba5Ed099…`) — present on Base + most EVM chains, NOT documented on Arc per ADR-0015. */
    readonly createX?: `0x${string}`;
  };
  /**
   * x402 facilitator URL — Coinbase-hosted, supports chains they facilitate.
   * Not currently available for Arc per `docs.arc.io`; omit on chains
   * where x402 pay-per-call is not in scope (Sage's task-escrow path on
   * Arc works independently of x402 — ADR-0003).
   */
  readonly x402FacilitatorDefault?: string;
}

export const baseSepolia: ChainConfig = {
  chainId: 84532,
  name: 'base-sepolia',
  rpc: 'https://sepolia.base.org',
  explorer: 'https://sepolia.basescan.org',
  contracts: {
    agentRegistry: '0x5e95f92feeb4d46249dc3525c58596856029c661',
    // V3 (arbitration-aware, ADR-0017): 0x61c585630b32eee0b8c00306047c301b56419a81.
    // V2 (deprecated, in-flight only): 0x12aef3529b8404709125b727ba3db40cd5453e1e.
    taskEscrow: '0x61c585630b32eee0b8c00306047c301b56419a81',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};

export const base: ChainConfig = {
  chainId: 8453,
  name: 'base',
  rpc: 'https://mainnet.base.org',
  explorer: 'https://basescan.org',
  contracts: {
    agentRegistry: '0x5e95F92FeEb4D46249DC3525C58596856029c661',
    // V3 (arbitration-aware, ADR-0017): 0x61c585630B32eee0b8c00306047c301B56419a81.
    // V2 (deprecated, in-flight only): 0x12aeF3529b8404709125b727bA3Db40cD5453E1e.
    taskEscrow: '0x61c585630B32eee0b8c00306047c301B56419a81',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};
