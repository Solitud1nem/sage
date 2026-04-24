import { parseAbi } from 'viem';

/**
 * Event ABIs for TaskEscrow — what the live tx stream subscribes to.
 *
 * Source of truth: packages/contracts/src/TaskEscrow.sol events.
 * We keep a local copy here for parseAbi-speed at build time; if events change,
 * run a regeneration step in M-INT.8 CI.
 */
export const taskEscrowEventsAbi = parseAbi([
  'event TaskCreated(uint256 indexed taskId, address indexed client, address indexed executor, uint256 amount, uint64 deadline, string specUri)',
  'event TaskAccepted(uint256 indexed taskId, address indexed executor)',
  'event TaskCompleted(uint256 indexed taskId, string resultUri)',
  'event TaskPaid(uint256 indexed taskId)',
  'event TaskDisputed(uint256 indexed taskId, string reason)',
  'event TaskExpired(uint256 indexed taskId)',
]);

export type TaskEscrowEventName =
  | 'TaskCreated'
  | 'TaskAccepted'
  | 'TaskCompleted'
  | 'TaskPaid'
  | 'TaskDisputed'
  | 'TaskExpired';

/** Shortened function-call name for each event (matches SDK verbs). */
export const EVENT_TO_METHOD: Record<TaskEscrowEventName, string> = {
  TaskCreated: 'createTask',
  TaskAccepted: 'acceptTask',
  TaskCompleted: 'completeTask',
  TaskPaid: 'approvePayment',
  TaskDisputed: 'disputeTask',
  TaskExpired: 'refundExpired',
};
