import { describe, it, expect } from 'vitest';
import {
  SAGE_PROTOCOL_VERSION,
  baseSepolia,
  base,
  arcTestnet,
  createSageClient,
  agentRegistryAbi,
  taskEscrowAbi,
} from '../src/index.js';

describe('@sage/adapter-evm exports', () => {
  it('re-exports core protocol version', () => {
    expect(SAGE_PROTOCOL_VERSION).toBe('2.0.0');
  });

  it('exports chain configs', () => {
    expect(baseSepolia.chainId).toBe(84532);
    expect(baseSepolia.name).toBe('base-sepolia');
    expect(baseSepolia.contracts.agentRegistry).toBe('0x5e95f92feeb4d46249dc3525c58596856029c661');
    expect(baseSepolia.contracts.taskEscrow).toBe('0x12aef3529b8404709125b727ba3db40cd5453e1e');

    expect(base.chainId).toBe(8453);
    expect(base.name).toBe('base');
    expect(base.contracts.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('exports ABIs', () => {
    expect(agentRegistryAbi).toBeDefined();
    expect(Array.isArray(agentRegistryAbi)).toBe(true);
    expect(agentRegistryAbi.length).toBeGreaterThan(0);

    expect(taskEscrowAbi).toBeDefined();
    expect(Array.isArray(taskEscrowAbi)).toBe(true);
    expect(taskEscrowAbi.length).toBeGreaterThan(0);
  });

  it('exports createSageClient function', () => {
    expect(typeof createSageClient).toBe('function');
  });
});

describe('chain configs', () => {
  it('baseSepolia has all required contract addresses', () => {
    const { contracts } = baseSepolia;
    expect(contracts.agentRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contracts.taskEscrow).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contracts.usdc).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contracts.eas).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(contracts.createX).toBe('0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed');
  });

  it('base has correct USDC address', () => {
    expect(base.contracts.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('both chains have x402 facilitator', () => {
    expect(baseSepolia.x402FacilitatorDefault).toBe('https://facilitator.coinbase.com');
    expect(base.x402FacilitatorDefault).toBe('https://facilitator.coinbase.com');
  });

  it('arcTestnet has Arc chainId + verified USDC + omits chain-specific fields', () => {
    // Per ADR-0015: Arc bridge state. USDC address is verified canonical
    // Circle USDC v2; agentRegistry + taskEscrow are zero-sentinels until
    // first deploy lands. EAS / CreateX / x402 facilitator are absent on
    // Arc and intentionally omitted from the config.
    expect(arcTestnet.chainId).toBe(5042002);
    expect(arcTestnet.name).toBe('arc-testnet');
    expect(arcTestnet.rpc).toBe('https://rpc.testnet.arc.network');
    expect(arcTestnet.explorer).toBe('https://testnet.arcscan.app');
    expect(arcTestnet.contracts.usdc).toBe('0x3600000000000000000000000000000000000000');
    expect(arcTestnet.contracts.agentRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(arcTestnet.contracts.taskEscrow).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(arcTestnet.contracts.eas).toBeUndefined();
    expect(arcTestnet.contracts.easSchemaRegistry).toBeUndefined();
    expect(arcTestnet.contracts.createX).toBeUndefined();
    expect(arcTestnet.x402FacilitatorDefault).toBeUndefined();
  });
});

describe('ABI validation', () => {
  it('agentRegistryAbi contains registerAgent', () => {
    const fn = agentRegistryAbi.find(
      (item: any) => item.type === 'function' && item.name === 'registerAgent',
    );
    expect(fn).toBeDefined();
  });

  it('agentRegistryAbi contains getAgent', () => {
    const fn = agentRegistryAbi.find(
      (item: any) => item.type === 'function' && item.name === 'getAgent',
    );
    expect(fn).toBeDefined();
  });

  it('taskEscrowAbi contains createTask', () => {
    const fn = taskEscrowAbi.find(
      (item: any) => item.type === 'function' && item.name === 'createTask',
    );
    expect(fn).toBeDefined();
  });

  it('taskEscrowAbi contains approvePayment', () => {
    const fn = taskEscrowAbi.find(
      (item: any) => item.type === 'function' && item.name === 'approvePayment',
    );
    expect(fn).toBeDefined();
  });

  it('taskEscrowAbi contains GRACE_PERIOD', () => {
    const fn = taskEscrowAbi.find(
      (item: any) => item.type === 'function' && item.name === 'GRACE_PERIOD',
    );
    expect(fn).toBeDefined();
  });
});
