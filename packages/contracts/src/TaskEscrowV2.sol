// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITaskEscrowV2} from "./interfaces/ITaskEscrowV2.sol";

/**
 * @title TaskEscrowV2
 * @notice Task-level escrow with arbitration layer (per ADR-0017).
 *
 *         Adds three things over v1:
 *           1. `resolveDispute(taskId, outcome, executorShare)` — single exit from Disputed.
 *              Authorized only for the configured `arbiter` address (an EOA Sage holds).
 *              Outcomes: Paid (full to executor), Refunded (full to client), or Split
 *              (partial — executorShare to executor, remainder to client).
 *           2. `setArbiter` under `Ownable2Step.onlyOwner` — arbiter address lives in
 *              storage so the council mechanism can rotate without redeploying the
 *              contract. Owner migrates to Safe / multisig via the two-step transfer
 *              built into Ownable2Step (fat-finger protection).
 *           3. `Refunded` becomes a reachable terminal status. `refundExpired` continues
 *              to write `Expired` (different cause: deadline vs dispute).
 *
 *         All v1 write paths are byte-equivalent to TaskEscrow.sol — only the storage
 *         layout extends (new arbiter slot + Ownable2Step state + Task.executorShare).
 *         v1.0 contracts at sage:escrow:v1 stay deployed and continue serving in-flight
 *         tasks until they terminate; v3.0 (this contract) deploys at a new address via
 *         salt keccak256("sage:escrow:v2").
 *
 *         Deploy: CreateX + CREATE3 with salt keccak256("sage:escrow:v2") (ADR-0001).
 *         Settlement: USDC-only via EIP-2612 permit (ADR-0004).
 *
 *         AgentRegistry is NOT a hard dependency — this contract works with any EOA.
 *         Registry verification is the SDK's responsibility (ADR-0002).
 */
contract TaskEscrowV2 is ITaskEscrowV2, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    // ───────── Internal helpers (modifier logic wrappers) ─────────

    function _checkTaskExists(uint256 taskId) internal view {
        if (taskId >= nextTaskId) revert TaskNotFound();
    }

    function _checkOnlyClient(uint256 taskId) internal view {
        if (msg.sender != _tasks[taskId].client) revert Unauthorized();
    }

    function _checkOnlyExecutor(uint256 taskId) internal view {
        if (msg.sender != _tasks[taskId].executor) revert Unauthorized();
    }

    function _checkOnlyArbiter() internal view {
        if (msg.sender != arbiter) revert Unauthorized();
    }

    function _checkInStatus(uint256 taskId, TaskStatus required) internal view {
        TaskStatus current = _tasks[taskId].status;
        if (current != required) revert InvalidStatus(current, required);
    }

    // ───────── Constants ─────────

    /// @inheritdoc ITaskEscrowV2
    uint64 public constant GRACE_PERIOD = 300; // 5 minutes

    // ───────── Immutables ─────────

    /// @notice USDC token contract for this chain.
    IERC20 public immutable USDC; // solhint-disable-line var-name-mixedcase

    // ───────── Storage ─────────

    /// @inheritdoc ITaskEscrowV2
    uint256 public nextTaskId;

    /// @notice Current arbiter EOA. Rotated via `setArbiter` under `onlyOwner`.
    address public arbiter;

    /// @notice Task records by ID.
    mapping(uint256 => Task) private _tasks;

    // ───────── Constructor ─────────

    /// @param _usdc           USDC token address for this chain (e.g. Circle USDC on Base).
    /// @param _initialOwner   Owner EOA. Holds `setArbiter` authority. Migrate to Safe via
    ///                        transferOwnership / acceptOwnership (Ownable2Step two-step).
    /// @param _initialArbiter Arbiter EOA at launch. May be the same as owner during early
    ///                        operation; rotate via setArbiter when council infra exists.
    constructor(
        IERC20 _usdc,
        address _initialOwner,
        address _initialArbiter
    ) Ownable(_initialOwner) {
        if (_initialArbiter == address(0)) revert ZeroArbiter();
        USDC = _usdc;
        arbiter = _initialArbiter;
        emit ArbiterChanged(address(0), _initialArbiter);
    }

    // ───────── Modifiers ─────────

    modifier taskExists(uint256 taskId) {
        _checkTaskExists(taskId);
        _;
    }

    modifier onlyClient(uint256 taskId) {
        _checkOnlyClient(taskId);
        _;
    }

    modifier onlyExecutor(uint256 taskId) {
        _checkOnlyExecutor(taskId);
        _;
    }

    modifier onlyArbiter() {
        _checkOnlyArbiter();
        _;
    }

    modifier inStatus(uint256 taskId, TaskStatus required) {
        _checkInStatus(taskId, required);
        _;
    }

    // ───────── Write functions — v1 surface (preserved) ─────────

    /// @inheritdoc ITaskEscrowV2
    function createTask(
        address executor,
        uint64 deadline,
        uint256 amount,
        string calldata specUri,
        PermitData calldata permit
    ) external nonReentrant returns (uint256 taskId) {
        if (executor == address(0)) revert ZeroExecutor();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlinePast();
        if (bytes(specUri).length == 0) revert EmptySpecUri();

        try IERC20Permit(address(USDC)).permit(
            msg.sender, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
        ) {} catch {} // solhint-disable-line no-empty-blocks

        USDC.safeTransferFrom(msg.sender, address(this), amount);

        taskId = nextTaskId++;

        _tasks[taskId] = Task({
            client: msg.sender,
            executor: executor,
            amount: amount,
            deadline: deadline,
            status: TaskStatus.Created,
            specUri: specUri,
            resultUri: "",
            completedAt: 0,
            executorShare: 0
        });

        emit TaskCreated(taskId, msg.sender, executor, amount, deadline, specUri);
    }

    /// @inheritdoc ITaskEscrowV2
    function acceptTask(uint256 taskId)
        external
        taskExists(taskId)
        onlyExecutor(taskId)
        inStatus(taskId, TaskStatus.Created)
    {
        Task storage task = _tasks[taskId];
        if (block.timestamp >= task.deadline) revert DeadlinePast();

        task.status = TaskStatus.Accepted;

        emit TaskAccepted(taskId, msg.sender);
    }

    /// @inheritdoc ITaskEscrowV2
    function completeTask(uint256 taskId, string calldata resultUri)
        external
        taskExists(taskId)
        onlyExecutor(taskId)
        inStatus(taskId, TaskStatus.Accepted)
    {
        if (bytes(resultUri).length == 0) revert EmptyResultUri();

        Task storage task = _tasks[taskId];
        task.status = TaskStatus.Completed;
        task.resultUri = resultUri;
        task.completedAt = uint64(block.timestamp);

        emit TaskCompleted(taskId, resultUri);
    }

    /// @inheritdoc ITaskEscrowV2
    function approvePayment(uint256 taskId)
        external
        nonReentrant
        taskExists(taskId)
        onlyClient(taskId)
        inStatus(taskId, TaskStatus.Completed)
    {
        Task storage task = _tasks[taskId];
        task.status = TaskStatus.Paid;

        USDC.safeTransfer(task.executor, task.amount);

        emit TaskPaid(taskId);
    }

    /// @inheritdoc ITaskEscrowV2
    function disputeTask(uint256 taskId, string calldata reason)
        external
        taskExists(taskId)
        onlyClient(taskId)
        inStatus(taskId, TaskStatus.Completed)
    {
        if (bytes(reason).length == 0) revert EmptyReason();

        _tasks[taskId].status = TaskStatus.Disputed;

        emit TaskDisputed(taskId, reason);
    }

    /// @inheritdoc ITaskEscrowV2
    function refundExpired(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = _tasks[taskId];
        TaskStatus status = task.status;

        if (status != TaskStatus.Created && status != TaskStatus.Accepted) {
            revert InvalidStatus(status, TaskStatus.Created);
        }

        if (block.timestamp < task.deadline) revert DeadlineNotPassed();

        task.status = TaskStatus.Expired;

        USDC.safeTransfer(task.client, task.amount);

        emit TaskExpired(taskId);
    }

    /// @inheritdoc ITaskEscrowV2
    function claimAutoRelease(uint256 taskId)
        external
        nonReentrant
        taskExists(taskId)
        onlyExecutor(taskId)
        inStatus(taskId, TaskStatus.Completed)
    {
        Task storage task = _tasks[taskId];

        if (block.timestamp < task.completedAt + GRACE_PERIOD) {
            revert GracePeriodNotElapsed();
        }

        task.status = TaskStatus.Paid;

        USDC.safeTransfer(task.executor, task.amount);

        emit TaskPaid(taskId);
    }

    // ───────── Write functions — V2 arbitration ─────────

    /// @inheritdoc ITaskEscrowV2
    function resolveDispute(
        uint256 taskId,
        TaskStatus outcome,
        uint256 executorShare
    )
        external
        nonReentrant
        taskExists(taskId)
        onlyArbiter
        inStatus(taskId, TaskStatus.Disputed)
    {
        Task storage task = _tasks[taskId];
        uint256 amount = task.amount;

        if (outcome == TaskStatus.Paid) {
            // Full payout to executor. executorShare must be 0 (intent must be explicit).
            if (executorShare != 0) revert InvalidExecutorShare();
            task.status = TaskStatus.Paid;
            USDC.safeTransfer(task.executor, amount);
            emit TaskResolved(taskId, TaskStatus.Paid, amount, msg.sender);
        } else if (outcome == TaskStatus.Refunded) {
            // Full refund to client. executorShare must be 0.
            if (executorShare != 0) revert InvalidExecutorShare();
            task.status = TaskStatus.Refunded;
            USDC.safeTransfer(task.client, amount);
            emit TaskResolved(taskId, TaskStatus.Refunded, 0, msg.sender);
        } else if (outcome == TaskStatus.Split) {
            // Partial. Strict bounds: 0 < executorShare < amount. Full-payout / full-refund
            // edges go through the Paid / Refunded branches above for clarity in the event log.
            if (executorShare == 0 || executorShare >= amount) revert InvalidExecutorShare();
            task.status = TaskStatus.Split;
            task.executorShare = executorShare;
            // Order: executor first, then client. Both are USDC ERC-20 transfers; safeTransfer
            // already handles reverts. nonReentrant + Disputed → Split state transition above
            // closes any reentry surface.
            USDC.safeTransfer(task.executor, executorShare);
            USDC.safeTransfer(task.client, amount - executorShare);
            emit TaskResolved(taskId, TaskStatus.Split, executorShare, msg.sender);
        } else {
            revert InvalidOutcome();
        }
    }

    /// @inheritdoc ITaskEscrowV2
    function setArbiter(address newArbiter) external onlyOwner {
        if (newArbiter == address(0)) revert ZeroArbiter();
        address previous = arbiter;
        arbiter = newArbiter;
        emit ArbiterChanged(previous, newArbiter);
    }

    // ───────── View functions ─────────

    /// @inheritdoc ITaskEscrowV2
    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }
}
