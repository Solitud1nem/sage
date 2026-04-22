// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITaskEscrow
 * @notice Task-level escrow for multi-step AI agent work with USDC settlement.
 *         Deployed on every supported EVM chain via CreateX + CREATE3 (ADR-0001).
 *         Settlement: USDC-only with EIP-2612 permit (ADR-0004).
 */
interface ITaskEscrow {
    // ───────── Enums ─────────

    enum TaskStatus {
        Created,    // 0 — USDC locked, waiting for executor to accept
        Accepted,   // 1 — executor accepted, work in progress
        Completed,  // 2 — executor submitted result, grace period running
        Paid,       // 3 — USDC released to executor (terminal)
        Disputed,   // 4 — client disputed, auto-release cancelled
        Refunded,   // 5 — USDC returned to client (terminal)
        Expired     // 6 — deadline passed, USDC returned (terminal)
    }

    // ───────── Structs ─────────

    struct Task {
        address client;
        address executor;
        uint256 amount;
        uint64 deadline;
        TaskStatus status;
        string specUri;
        string resultUri;
        uint64 completedAt;
    }

    /// @notice EIP-2612 permit data for single-tx USDC approval + escrow lock.
    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // ───────── Events ─────────

    event TaskCreated(
        uint256 indexed taskId,
        address indexed client,
        address indexed executor,
        uint256 amount,
        uint64 deadline,
        string specUri
    );
    event TaskAccepted(uint256 indexed taskId, address indexed executor);
    event TaskCompleted(uint256 indexed taskId, string resultUri);
    event TaskPaid(uint256 indexed taskId);
    event TaskDisputed(uint256 indexed taskId, string reason);
    event TaskRefunded(uint256 indexed taskId);
    event TaskExpired(uint256 indexed taskId);

    // ───────── Errors ─────────

    /// @notice Task does not exist.
    error TaskNotFound();

    /// @notice Task is not in the required status for this operation.
    error InvalidStatus(TaskStatus current, TaskStatus required);

    /// @notice Caller is not authorized for this operation.
    error Unauthorized();

    /// @notice Deadline must be in the future.
    error DeadlinePast();

    /// @notice Amount must be greater than zero.
    error ZeroAmount();

    /// @notice Executor address must not be zero.
    error ZeroExecutor();

    /// @notice Spec URI must not be empty.
    error EmptySpecUri();

    /// @notice Result URI must not be empty.
    error EmptyResultUri();

    /// @notice Dispute reason must not be empty.
    error EmptyReason();

    /// @notice Task deadline has not yet passed (cannot refund).
    error DeadlineNotPassed();

    /// @notice Grace period has not yet elapsed (cannot claim auto-release).
    error GracePeriodNotElapsed();

    // ───────── Write functions ─────────

    /// @notice Create a task with USDC locked via EIP-2612 permit (single tx).
    /// @param executor Address of the agent assigned to the task.
    /// @param deadline Unix timestamp (seconds) by which the task must be completed.
    /// @param amount USDC amount to lock (6 decimals).
    /// @param specUri URI pointing to the task specification.
    /// @param permit EIP-2612 permit data for USDC approval.
    /// @return taskId The new task's unique identifier.
    function createTask(
        address executor,
        uint64 deadline,
        uint256 amount,
        string calldata specUri,
        PermitData calldata permit
    ) external returns (uint256 taskId);

    /// @notice Accept an assigned task (executor only). Created → Accepted.
    function acceptTask(uint256 taskId) external;

    /// @notice Submit result and mark task complete (executor only). Accepted → Completed.
    function completeTask(uint256 taskId, string calldata resultUri) external;

    /// @notice Approve and release USDC to executor (client only). Completed → Paid.
    function approvePayment(uint256 taskId) external;

    /// @notice Dispute a completed task (client only). Completed → Disputed.
    function disputeTask(uint256 taskId, string calldata reason) external;

    /// @notice Refund expired task (anyone). Created|Accepted → Refunded if deadline passed.
    function refundExpired(uint256 taskId) external;

    /// @notice Claim auto-release after grace period (executor only). Completed → Paid.
    function claimAutoRelease(uint256 taskId) external;

    // ───────── View functions ─────────

    /// @notice Get task record by ID.
    function getTask(uint256 taskId) external view returns (Task memory);

    /// @notice Current number of tasks created.
    function nextTaskId() external view returns (uint256);

    /// @notice Grace period duration in seconds (default: 300).
    function GRACE_PERIOD() external view returns (uint64);
}
