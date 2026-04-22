/**
 * Base chain configuration for Sage protocol.
 * Base Sepolia for testnet, Base mainnet for production.
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
    readonly eas: `0x${string}`;
    readonly easSchemaRegistry: `0x${string}`;
    readonly createX: `0x${string}`;
  };
  readonly x402FacilitatorDefault: string;
}

export const baseSepolia: ChainConfig = {
  chainId: 84532,
  name: 'base-sepolia',
  rpc: 'https://sepolia.base.org',
  explorer: 'https://sepolia.basescan.org',
  contracts: {
    agentRegistry: '0x5e95f92feeb4d46249dc3525c58596856029c661',
    taskEscrow: '0x12aef3529b8404709125b727ba3db40cd5453e1e',
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
    agentRegistry: '0x0000000000000000000000000000000000000000', // TBD after mainnet deploy
    taskEscrow: '0x0000000000000000000000000000000000000000',    // TBD after mainnet deploy
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    eas: '0x4200000000000000000000000000000000000021',
    easSchemaRegistry: '0x4200000000000000000000000000000000000020',
    createX: '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed',
  },
  x402FacilitatorDefault: 'https://facilitator.coinbase.com',
};
