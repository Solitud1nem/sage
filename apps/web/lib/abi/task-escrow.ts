/**
 * Write-function ABI for TaskEscrow — used for wallet-mode signatures
 * (createTask, approvePayment). Minimal set; full events live in
 * `task-escrow-events.ts`.
 */

export const taskEscrowAbi = [
  // ── Struct ─────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'createTask',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'executor', type: 'address' },
      { name: 'deadline', type: 'uint64' },
      { name: 'amount', type: 'uint256' },
      { name: 'specUri', type: 'string' },
      {
        name: 'permit',
        type: 'tuple',
        components: [
          { name: 'value', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
    ],
    outputs: [{ name: 'taskId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approvePayment',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getTask',
    stateMutability: 'view',
    inputs: [{ name: 'taskId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'client', type: 'address' },
          { name: 'executor', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'deadline', type: 'uint64' },
          { name: 'status', type: 'uint8' },
          { name: 'specUri', type: 'string' },
          { name: 'resultUri', type: 'string' },
          { name: 'completedAt', type: 'uint64' },
          // V3 (arbitration) field — USDC awarded to executor on Split. 0 for
          // all non-Split terminals. The deployed escrow is V3, so the mirror
          // must carry it (decoding worked without it, but the shape now matches).
          { name: 'executorShare', type: 'uint256' },
        ],
      },
    ],
  },
  // ── Events (subset needed for wallet-mode flow) ───────────────────
  {
    type: 'event',
    name: 'TaskCreated',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint64', indexed: false },
      { name: 'specUri', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskAccepted',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'executor', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TaskCompleted',
    inputs: [
      { name: 'taskId', type: 'uint256', indexed: true },
      { name: 'resultUri', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'TaskPaid',
    inputs: [{ name: 'taskId', type: 'uint256', indexed: true }],
  },
] as const;

export const usdcAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * TaskStatus mirror — must match the on-chain enum order in
 * `packages/contracts/src/interfaces/ITaskEscrowV2.sol` (the deployed escrow is
 * V3/arbitration-aware). The enum starts at 0 with Created (no None sentinel),
 * so any drift here causes silent timeouts: polling for `status >= Completed`
 * waits forever when the value is +1 off. If you touch this, also touch the
 * contract — and prefer importing from @sage/core where possible.
 */
export enum TaskStatus {
  Created = 0,
  Accepted = 1,
  Completed = 2,
  Paid = 3,
  Disputed = 4,
  Refunded = 5,
  Expired = 6,
  /** V3 terminal: arbiter awarded partial USDC to each side. See `executorShare`. */
  Split = 7,
}
