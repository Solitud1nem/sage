/**
 * Shared EIP-2612 permit signer for `createTask` (code review 2026-06-09,
 * CR.13). Previously duplicated verbatim in `task-escrow.ts` and
 * `task-escrow-v2.ts`, both hardcoding `version: '2'`.
 *
 * Domain resolution order:
 *   1. EIP-5267 `eip712Domain()` — authoritative `name`/`version` straight
 *      from the token (Circle FiatTokenV2_2 implements it).
 *   2. Fallback on any error: `name()` + version `'2'` — the exact behavior
 *      this module replaced, so tokens without EIP-5267 lose nothing.
 *
 * The resolved domain is cached per `chainId:token` (it cannot change for a
 * deployed token), saving one or two reads on every permit after the first.
 * Nonces are always read fresh.
 */

import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';

type BoundWalletClient = WalletClient<Transport, Chain, Account>;

export interface PermitSignature {
  value: bigint;
  deadline: bigint;
  v: number;
  r: `0x${string}`;
  s: `0x${string}`;
}

interface PermitDomain {
  name: string;
  version: string;
}

const EIP5267_ABI = [
  {
    name: 'eip712Domain',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
] as const;

const ERC20_NAME_ABI = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const NONCES_ABI = [
  {
    name: 'nonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const domainCache = new Map<string, PermitDomain>();

async function resolveDomain(
  publicClient: PublicClient,
  token: `0x${string}`,
  chainId: number,
): Promise<PermitDomain> {
  const cacheKey = `${chainId}:${token.toLowerCase()}`;
  const cached = domainCache.get(cacheKey);
  if (cached) return cached;

  let domain: PermitDomain;
  try {
    const [, name, version] = await publicClient.readContract({
      address: token,
      abi: EIP5267_ABI,
      functionName: 'eip712Domain',
    });
    domain = { name, version };
  } catch {
    // Token predates EIP-5267 (or the read failed) — legacy path.
    const name = await publicClient.readContract({
      address: token,
      abi: ERC20_NAME_ABI,
      functionName: 'name',
    });
    domain = { name, version: '2' };
  }

  domainCache.set(cacheKey, domain);
  return domain;
}

/**
 * Build a permit signer bound to a token + spender. The returned function
 * signs an EIP-2612 `Permit` for `amount`, valid for 1 hour.
 */
export function createPermitSigner(
  publicClient: PublicClient,
  walletClient: BoundWalletClient,
  tokenAddress: `0x${string}`,
  spender: `0x${string}`,
): (amount: bigint) => Promise<PermitSignature> {
  return async (amount: bigint): Promise<PermitSignature> => {
    const account = walletClient.account;
    if (!account) throw new Error('WalletClient must have an account');

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const chainId = await publicClient.getChainId();
    const [{ name, version }, nonce] = await Promise.all([
      resolveDomain(publicClient, tokenAddress, chainId),
      publicClient.readContract({
        address: tokenAddress,
        abi: NONCES_ABI,
        functionName: 'nonces',
        args: [account.address],
      }),
    ]);

    const signature = await walletClient.signTypedData({
      account,
      domain: {
        name,
        version,
        chainId,
        verifyingContract: tokenAddress,
      },
      types: {
        Permit: [
          { name: 'owner', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      primaryType: 'Permit',
      message: {
        owner: account.address,
        spender,
        value: amount,
        nonce,
        deadline,
      },
    });

    const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
    const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
    const v = parseInt(signature.slice(130, 132), 16);

    return { value: amount, deadline, v, r, s };
  };
}

export const __testing = {
  clearDomainCache(): void {
    domainCache.clear();
  },
};
