// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITaskEscrow} from "./interfaces/ITaskEscrow.sol";

/**
 * @title TaskEscrow
 * @notice Task-level escrow for multi-step AI agent work with USDC settlement.
 *
 *         Lifecycle: Created → Accepted → Completed → Paid/Disputed/Refunded/Expired
 *         Settlement: USDC-only via EIP-2612 permit for single-tx UX (ADR-0004).
 *         Deploy: CreateX + CREATE3, salt keccak256("sage:escrow:v1") (ADR-0001).
 *
 *         AgentRegistry is NOT a hard dependency — this contract works with any EOA.
 *         Registry verification is the SDK's responsibility (ADR-0002).
 */
contract TaskEscrow is ITaskEscrow, ReentrancyGuard {
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

    function _checkInStatus(uint256 taskId, TaskStatus required) internal view {
        TaskStatus current = _tasks[taskId].status;
        if (current != required) revert InvalidStatus(current, required);
    }

    // ───────── Constants ─────────

    /// @inheritdoc ITaskEscrow
    uint64 public constant GRACE_PERIOD = 300; // 5 minutes

    // ───────── Immutables ─────────

    /// @notice USDC token contract for this chain.
    IERC20 public immutable USDC; // solhint-disable-line var-name-mixedcase

    // ───────── Storage ─────────

    /// @inheritdoc ITaskEscrow
    uint256 public nextTaskId;

    /// @notice Task records by ID.
    mapping(uint256 => Task) private _tasks;

    // ───────── Constructor ─────────

    /// @param _usdc USDC token address for this chain (e.g. Circle USDC on Base).
    constructor(IERC20 _usdc) {
        USDC = _usdc;
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

    modifier inStatus(uint256 taskId, TaskStatus required) {
        _checkInStatus(taskId, required);
        _;
    }

    // ───────── Write functions — M2.7 (core) ─────────

    /// @inheritdoc ITaskEscrow
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

        // Execute EIP-2612 permit for single-tx UX.
        // If permit was already submitted or allowance is sufficient, this may revert.
        // Wrapping in try/catch allows pre-approved scenarios.
        try IERC20Permit(address(USDC)).permit(
            msg.sender, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
        ) {} catch {} // solhint-disable-line no-empty-blocks

        // Transfer USDC from client to escrow
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
            completedAt: 0
        });

        emit TaskCreated(taskId, msg.sender, executor, amount, deadline, specUri);
    }

    /// @inheritdoc ITaskEscrow
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

    /// @inheritdoc ITaskEscrow
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

    // ───────── Write functions — M2.8 (remaining) ─────────

    /// @inheritdoc ITaskEscrow
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

    /// @inheritdoc ITaskEscrow
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

    /// @inheritdoc ITaskEscrow
    function refundExpired(uint256 taskId) external nonReentrant taskExists(taskId) {
        Task storage task = _tasks[taskId];
        TaskStatus status = task.status;

        // Only refundable from Created or Accepted
        if (status != TaskStatus.Created && status != TaskStatus.Accepted) {
            revert InvalidStatus(status, TaskStatus.Created);
        }

        if (block.timestamp < task.deadline) revert DeadlineNotPassed();

        task.status = TaskStatus.Expired;

        USDC.safeTransfer(task.client, task.amount);

        emit TaskExpired(taskId);
    }

    /// @inheritdoc ITaskEscrow
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

    // ───────── View functions ─────────

    /// @inheritdoc ITaskEscrow
    function getTask(uint256 taskId) external view returns (Task memory) {
        return _tasks[taskId];
    }
}
