import { describe, it, expect } from 'vitest';
import type { PublicClient } from 'viem';

import { createAllowanceEnsurer, ZERO_PERMIT } from '../src/approve.js';
import { createTaskEscrowV2Client } from '../src/task-escrow-v2.js';

const OWNER = '0x6D8aCa48c1E064e71078656f7fB946e52cd8376d' as const;
const ESCROW = '0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac' as const;
const WMON = '0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541' as const;
const APPROVE_HASH = (`0x${'aa'.repeat(32)}`) as `0x${string}`;
const CREATE_HASH = (`0x${'bb'.repeat(32)}`) as `0x${string}`;

// TaskCreated(uint256 indexed taskId, ...) topic — mirrors task-escrow clients.
const TASK_CREATED_TOPIC = '0x7407b0ef416b5ba5fe0caf5447bb4b7bbbd2adc61093638361dd31a28b14fc5c';

interface WriteCall {
  functionName: string;
  address: string;
  args: readonly unknown[];
}

function mockClients(opts: { allowance: bigint; approveStatus?: 'success' | 'reverted' }) {
  const writes: WriteCall[] = [];
  const reads: string[] = [];
  const signedTypedData: unknown[] = [];

  const publicClient = {
    async getChainId() {
      return 10143;
    },
    async readContract({ functionName }: { functionName: string }) {
      reads.push(functionName);
      if (functionName === 'allowance') return opts.allowance;
      throw new Error(`unexpected read: ${functionName}`);
    },
    async waitForTransactionReceipt({ hash }: { hash: `0x${string}` }) {
      if (hash === APPROVE_HASH) {
        return { status: opts.approveStatus ?? 'success', logs: [] };
      }
      // createTask receipt with a TaskCreated log for taskId 5.
      return {
        status: 'success',
        logs: [
          {
            address: ESCROW,
            topics: [TASK_CREATED_TOPIC, `0x${'0'.repeat(63)}5`],
          },
        ],
      };
    },
  } as unknown as PublicClient;

  const walletClient = {
    account: { address: OWNER },
    async writeContract(call: WriteCall) {
      writes.push(call);
      return call.functionName === 'approve' ? APPROVE_HASH : CREATE_HASH;
    },
    async signTypedData(args: unknown) {
      signedTypedData.push(args);
      throw new Error('signTypedData must not be called on the approve-path');
    },
  };

  return { publicClient, walletClient: walletClient as never, writes, reads, signedTypedData };
}

describe('createAllowanceEnsurer', () => {
  it('skips approve when the allowance already covers the amount', async () => {
    const { publicClient, walletClient, writes } = mockClients({ allowance: 1_000n });
    const ensure = createAllowanceEnsurer(publicClient, walletClient, WMON, ESCROW);

    await ensure(500n);

    expect(writes).toHaveLength(0);
  });

  it('sends an exact-amount approve when the allowance is short', async () => {
    const { publicClient, walletClient, writes } = mockClients({ allowance: 0n });
    const ensure = createAllowanceEnsurer(publicClient, walletClient, WMON, ESCROW);

    await ensure(750n);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      functionName: 'approve',
      address: WMON,
      args: [ESCROW, 750n],
    });
  });

  it('throws when the approve tx reverts (Monad included-but-reverted edge)', async () => {
    const { publicClient, walletClient } = mockClients({
      allowance: 0n,
      approveStatus: 'reverted',
    });
    const ensure = createAllowanceEnsurer(publicClient, walletClient, WMON, ESCROW);

    await expect(ensure(1n)).rejects.toThrow(/reverted/);
  });
});

describe('createTask approve-path (permit: false)', () => {
  it('ensures allowance, passes ZERO_PERMIT, never signs typed data', async () => {
    const { publicClient, walletClient, writes, reads, signedTypedData } = mockClients({
      allowance: 0n,
    });
    const client = createTaskEscrowV2Client(publicClient, walletClient, ESCROW, WMON, {
      permit: false,
    });

    const id = await client.createTask({
      executor: OWNER,
      deadline: Math.floor(Date.now() / 1000) + 600,
      amount: 300n,
      specUri: 'data:application/json,{}',
    } as never);

    expect(id).toBe('5');
    expect(signedTypedData).toHaveLength(0);
    expect(reads).toContain('allowance');
    // Write #1: approve(escrow, amount); write #2: createTask with zeroed permit.
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ functionName: 'approve', args: [ESCROW, 300n] });
    expect(writes[1]).toMatchObject({ functionName: 'createTask', address: ESCROW });
    const permitArg = (writes[1].args as unknown[])[4];
    expect(permitArg).toEqual({
      value: ZERO_PERMIT.value,
      deadline: ZERO_PERMIT.deadline,
      v: ZERO_PERMIT.v,
      r: ZERO_PERMIT.r,
      s: ZERO_PERMIT.s,
    });
  });

  it('skips the approve write when allowance is already sufficient', async () => {
    const { publicClient, walletClient, writes } = mockClients({ allowance: 10_000n });
    const client = createTaskEscrowV2Client(publicClient, walletClient, ESCROW, WMON, {
      permit: false,
    });

    await client.createTask({
      executor: OWNER,
      deadline: Math.floor(Date.now() / 1000) + 600,
      amount: 300n,
      specUri: 'data:application/json,{}',
    } as never);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ functionName: 'createTask' });
  });
});
