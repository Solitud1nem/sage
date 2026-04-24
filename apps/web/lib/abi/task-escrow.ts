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

/** TaskStatus mirror (see @sage/core — kept local to avoid cross-package type quirks). */
export enum TaskStatus {
  None = 0,
  Created = 1,
  Accepted = 2,
  Completed = 3,
  Paid = 4,
  Disputed = 5,
  Refunded = 6,
  Expired = 7,
}
