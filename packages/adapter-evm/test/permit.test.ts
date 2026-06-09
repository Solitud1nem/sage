import { describe, it, expect, beforeEach } from 'vitest';
import type { PublicClient } from 'viem';

import { createPermitSigner, __testing } from '../src/permit.js';

const OWNER = '0x6D8aCa48c1E064e71078656f7fB946e52cd8376d' as const;
const SPENDER = '0x12aeF3529b8404709125b727bA3Db40cD5453E1e' as const;

// 65-byte signature: r = 0x11…, s = 0x22…, v = 0x1b (27).
const SIG = (`0x${'11'.repeat(32)}${'22'.repeat(32)}1b`) as `0x${string}`;

function mockClients(opts: {
  /** eip712Domain() behavior: tuple values, or 'revert' for pre-5267 tokens. */
  eip712: { name: string; version: string } | 'revert';
  /** name() result for the fallback path. */
  legacyName?: string;
}) {
  const reads: string[] = [];
  const domains: Array<Record<string, unknown>> = [];

  const publicClient = {
    async getChainId() {
      return 8453;
    },
    async readContract({ functionName }: { functionName: string }) {
      reads.push(functionName);
      if (functionName === 'eip712Domain') {
        if (opts.eip712 === 'revert') throw new Error('execution reverted');
        return [
          '0x0f',
          opts.eip712.name,
          opts.eip712.version,
          8453n,
          SPENDER,
          `0x${'0'.repeat(64)}`,
          [],
        ];
      }
      if (functionName === 'name') return opts.legacyName ?? 'USD Coin';
      if (functionName === 'nonces') return 7n;
      throw new Error(`unexpected read: ${functionName}`);
    },
  } as unknown as PublicClient;

  const walletClient = {
    account: { address: OWNER },
    async signTypedData(args: { domain: Record<string, unknown> }) {
      domains.push(args.domain);
      return SIG;
    },
  };

  return { publicClient, walletClient: walletClient as never, reads, domains };
}

// Unique token per test — the domain cache is module-global.
let tokenCounter = 0;
function nextToken(): `0x${string}` {
  tokenCounter += 1;
  return `0x${tokenCounter.toString(16).padStart(40, '0')}` as `0x${string}`;
}

describe('createPermitSigner', () => {
  beforeEach(() => {
    __testing.clearDomainCache();
  });

  it('uses eip712Domain() name/version when the token implements EIP-5267', async () => {
    const { publicClient, walletClient, reads, domains } = mockClients({
      eip712: { name: 'USDC', version: '2.2' },
    });
    const sign = createPermitSigner(publicClient, walletClient, nextToken(), SPENDER);

    const permit = await sign(1_000n);

    expect(domains[0]).toMatchObject({ name: 'USDC', version: '2.2', chainId: 8453 });
    expect(reads).toContain('eip712Domain');
    expect(reads).not.toContain('name');
    expect(permit).toMatchObject({
      value: 1_000n,
      v: 27,
      r: `0x${'11'.repeat(32)}`,
      s: `0x${'22'.repeat(32)}`,
    });
    expect(permit.deadline).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });

  it('falls back to name() + version "2" when eip712Domain reverts', async () => {
    const { publicClient, walletClient, reads, domains } = mockClients({
      eip712: 'revert',
      legacyName: 'USD Coin',
    });
    const sign = createPermitSigner(publicClient, walletClient, nextToken(), SPENDER);

    await sign(500n);

    expect(domains[0]).toMatchObject({ name: 'USD Coin', version: '2' });
    expect(reads).toContain('name');
  });

  it('caches the resolved domain per token; nonces stay fresh', async () => {
    const { publicClient, walletClient, reads } = mockClients({
      eip712: { name: 'USDC', version: '2.2' },
    });
    const sign = createPermitSigner(publicClient, walletClient, nextToken(), SPENDER);

    await sign(1n);
    await sign(2n);

    expect(reads.filter((f) => f === 'eip712Domain')).toHaveLength(1);
    expect(reads.filter((f) => f === 'nonces')).toHaveLength(2);
  });

  it('binds the permit message to the spender', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const { publicClient } = mockClients({ eip712: { name: 'USDC', version: '2.2' } });
    const walletClient = {
      account: { address: OWNER },
      async signTypedData(args: { message: Record<string, unknown> }) {
        messages.push(args.message);
        return SIG;
      },
    };
    const sign = createPermitSigner(publicClient, walletClient as never, nextToken(), SPENDER);

    await sign(42n);

    expect(messages[0]).toMatchObject({ owner: OWNER, spender: SPENDER, value: 42n, nonce: 7n });
  });
});
