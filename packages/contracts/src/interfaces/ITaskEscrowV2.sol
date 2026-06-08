// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITaskEscrowV2
 * @notice Task-level escrow with arbitration layer (per ADR-0017).
 *
 *         Lifecycle:
 *           Created → Accepted → Completed → Paid/Disputed/Expired (v1 paths preserved)
 *           Disputed → Paid | Refunded | Split           (new exits via resolveDispute)
 *
 *         Settlement: USDC-only with EIP-2612 permit (ADR-0004).
 *         Deploy: CreateX + CREATE3, salt keccak256("sage:escrow:v2") (ADR-0001).
 *         Arbitration: single on-chain `arbiter` EOA, set by `owner` (ADR-0017).
 */
interface ITaskEscrowV2 {
    // ───────── Enums ─────────

    enum TaskStatus {
        Created,    // 0 — USDC locked, waiting for executor to accept
        Accepted,   // 1 — executor accepted, work in progress
        Completed,  // 2 — executor submitted result, grace period running
        Paid,       // 3 — USDC released to executor (terminal). Reached via approvePayment,
                    //     claimAutoRelease, OR resolveDispute(outcome=Paid).
        Disputed,   // 4 — client disputed, awaiting arbiter resolution
        Refunded,   // 5 — USDC returned to client (terminal). Reached ONLY via
                    //     resolveDispute(outcome=Refunded). Distinct from Expired by cause.
        Expired,    // 6 — deadline passed without completion (terminal). Reached ONLY
                    //     via refundExpired.
        Split       // 7 — arbiter awarded partial to each side (terminal). executorShare stored.
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
        /// @notice Set only when status == Split. USDC amount awarded to executor;
        ///         (amount - executorShare) was returned to client. 0 for non-Split terminals.
        uint256 executorShare;
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
    event TaskExpired(uint256 indexed taskId);

    /// @notice Arbiter resolved a disputed task.
    /// @param taskId        Identifier of the resolved task.
    /// @param outcome       Resulting status: Paid | Refunded | Split.
    /// @param executorShare USDC amount sent to executor (== amount for Paid, 0 for Refunded,
    ///                      partial for Split). The remainder went to the client.
    /// @param arbiter       Arbiter address that submitted the resolution (for audit trail).
    event TaskResolved(
        uint256 indexed taskId,
        TaskStatus outcome,
        uint256 executorShare,
        address indexed arbiter
    );

    /// @notice Arbiter address was rotated.
    event ArbiterChanged(address indexed previousArbiter, address indexed newArbiter);

    // ───────── Errors ─────────

    error TaskNotFound();
    error InvalidStatus(TaskStatus current, TaskStatus required);
    error Unauthorized();
    error DeadlinePast();
    error ZeroAmount();
    error ZeroExecutor();
    error EmptySpecUri();
    error EmptyResultUri();
    error EmptyReason();
    error DeadlineNotPassed();
    error GracePeriodNotElapsed();

    // ─── New for V2 ───

    /// @notice Initial arbiter at deploy must be non-zero (use placeholder if needed,
    ///         e.g. 0x000…0001, never 0x0).
    error ZeroArbiter();

    /// @notice resolveDispute called with outcome not in {Paid, Refunded, Split}.
    error InvalidOutcome();

    /// @notice For outcome=Split: executorShare must satisfy 0 < executorShare < amount.
    ///         For outcome=Paid or Refunded: executorShare must equal 0 (caller passes
    ///         the explicit 0 to make intent unambiguous on-chain).
    error InvalidExecutorShare();

    // ───────── Write functions — v1 surface preserved ─────────

    function createTask(
        address executor,
        uint64 deadline,
        uint256 amount,
        string calldata specUri,
        PermitData calldata permit
    ) external returns (uint256 taskId);

    function acceptTask(uint256 taskId) external;
    function completeTask(uint256 taskId, string calldata resultUri) external;
    function approvePayment(uint256 taskId) external;
    function disputeTask(uint256 taskId, string calldata reason) external;
    function refundExpired(uint256 taskId) external;
    function claimAutoRelease(uint256 taskId) external;

    // ───────── Write functions — V2 arbitration ─────────

    /// @notice Resolve a disputed task. Arbiter-only.
    /// @dev Allowed outcomes: Paid (full to executor), Refunded (full to client),
    ///      Split (partial; executorShare to executor, remainder to client).
    ///      Reverts on any other outcome or on out-of-bounds executorShare.
    /// @param taskId        Task to resolve. Must be in status Disputed.
    /// @param outcome       Paid | Refunded | Split.
    /// @param executorShare USDC to executor when outcome=Split; must be 0 for Paid/Refunded.
    function resolveDispute(
        uint256 taskId,
        TaskStatus outcome,
        uint256 executorShare
    ) external;

    /// @notice Rotate the arbiter address. Owner-only.
    /// @dev See Ownable2Step on this contract for owner-transfer mechanics.
    /// @param newArbiter New arbiter EOA (must be non-zero).
    function setArbiter(address newArbiter) external;

    // ───────── View functions ─────────

    function getTask(uint256 taskId) external view returns (Task memory);
    function nextTaskId() external view returns (uint256);
    function GRACE_PERIOD() external view returns (uint64);

    /// @notice Current arbiter address. Read-only externally.
    function arbiter() external view returns (address);
}
