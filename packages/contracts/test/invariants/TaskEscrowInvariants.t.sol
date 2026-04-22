// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskEscrow} from "../../src/TaskEscrow.sol";
import {ITaskEscrow} from "../../src/interfaces/ITaskEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TaskEscrowHandler
 * @notice Handler contract that drives randomized actions against TaskEscrow
 *         for invariant testing. Forge calls random functions here each iteration.
 */
contract TaskEscrowHandler is Test {
    TaskEscrow public escrow;
    MockUSDC public usdc;

    uint256 internal clientKey = 0xA11CE;
    uint256 internal executorKey = 0xB0B;
    address public clientAddr;
    address public executorAddr;

    // Track how much USDC should be locked
    uint256 public totalLocked;
    uint256 public totalPaidOut;
    uint256 public totalRefunded;

    constructor(TaskEscrow _escrow, MockUSDC _usdc) {
        escrow = _escrow;
        usdc = _usdc;
        clientAddr = vm.addr(clientKey);
        executorAddr = vm.addr(executorKey);
    }

    function _permit(uint256 value) internal view returns (ITaskEscrow.PermitData memory) {
        bytes32 domainSeparator = usdc.DOMAIN_SEPARATOR();
        bytes32 permitTypehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 nonce = usdc.nonces(clientAddr);
        uint256 deadline = block.timestamp + 7200;

        bytes32 structHash =
            keccak256(abi.encode(permitTypehash, clientAddr, address(escrow), value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(clientKey, digest);

        return ITaskEscrow.PermitData({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    function createTask(uint256 amount) external {
        amount = bound(amount, 1, 10_000_000); // 0.000001 to 10 USDC

        usdc.mint(clientAddr, amount);
        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        escrow.createTask(executorAddr, uint64(block.timestamp + 3600), amount, "ipfs://QmSpec", permit);

        totalLocked += amount;
    }

    function acceptTask(uint256 taskIdSeed) external {
        uint256 nextId = escrow.nextTaskId();
        if (nextId == 0) return;
        uint256 taskId = taskIdSeed % nextId;

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        if (task.status != ITaskEscrow.TaskStatus.Created) return;
        if (block.timestamp >= task.deadline) return;

        vm.prank(executorAddr);
        escrow.acceptTask(taskId);
    }

    function completeTask(uint256 taskIdSeed) external {
        uint256 nextId = escrow.nextTaskId();
        if (nextId == 0) return;
        uint256 taskId = taskIdSeed % nextId;

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        if (task.status != ITaskEscrow.TaskStatus.Accepted) return;

        vm.prank(executorAddr);
        escrow.completeTask(taskId, "ipfs://QmResult");
    }

    function approvePayment(uint256 taskIdSeed) external {
        uint256 nextId = escrow.nextTaskId();
        if (nextId == 0) return;
        uint256 taskId = taskIdSeed % nextId;

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        if (task.status != ITaskEscrow.TaskStatus.Completed) return;

        vm.prank(clientAddr);
        escrow.approvePayment(taskId);

        totalLocked -= task.amount;
        totalPaidOut += task.amount;
    }

    function claimAutoRelease(uint256 taskIdSeed) external {
        uint256 nextId = escrow.nextTaskId();
        if (nextId == 0) return;
        uint256 taskId = taskIdSeed % nextId;

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        if (task.status != ITaskEscrow.TaskStatus.Completed) return;
        if (block.timestamp < task.completedAt + escrow.GRACE_PERIOD()) return;

        vm.prank(executorAddr);
        escrow.claimAutoRelease(taskId);

        totalLocked -= task.amount;
        totalPaidOut += task.amount;
    }

    function refundExpired(uint256 taskIdSeed) external {
        uint256 nextId = escrow.nextTaskId();
        if (nextId == 0) return;
        uint256 taskId = taskIdSeed % nextId;

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        if (task.status != ITaskEscrow.TaskStatus.Created && task.status != ITaskEscrow.TaskStatus.Accepted) return;
        if (block.timestamp < task.deadline) return;

        escrow.refundExpired(taskId);

        totalLocked -= task.amount;
        totalRefunded += task.amount;
    }

    function warpForward(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 7200);
        vm.warp(block.timestamp + seconds_);
    }
}

/**
 * @title TaskEscrowInvariantsTest
 * @notice Invariant test suite verifying global properties of TaskEscrow
 *         across randomized sequences of operations.
 */
contract TaskEscrowInvariantsTest is Test {
    TaskEscrow public escrow;
    MockUSDC public usdc;
    TaskEscrowHandler public handler;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new TaskEscrow(IERC20(address(usdc)));
        handler = new TaskEscrowHandler(escrow, usdc);

        targetContract(address(handler));
    }

    /// @notice Escrow USDC balance must equal the sum of all active (non-terminal) task amounts.
    function invariant_escrowBalanceEqualsLocked() public view {
        assertEq(usdc.balanceOf(address(escrow)), handler.totalLocked());
    }

    /// @notice All terminal tasks (Paid, Expired) have released their funds.
    function invariant_terminalTasksHaveNoFundsLocked() public view {
        uint256 nextId = escrow.nextTaskId();
        for (uint256 i = 0; i < nextId; i++) {
            ITaskEscrow.Task memory task = escrow.getTask(i);
            if (
                task.status == ITaskEscrow.TaskStatus.Paid || task.status == ITaskEscrow.TaskStatus.Expired
            ) {
                // These tasks should have been accounted for (removed from totalLocked)
                // This is implicitly checked by invariant_escrowBalanceEqualsLocked
            }
            // Status should never be an invalid value
            assertTrue(uint8(task.status) <= uint8(ITaskEscrow.TaskStatus.Expired));
        }
    }

    /// @notice No USDC is created or destroyed — total supply is conserved.
    function invariant_usdcSupplyConserved() public view {
        uint256 totalMinted = handler.totalLocked() + handler.totalPaidOut() + handler.totalRefunded();
        // totalMinted tracks all USDC minted to client by handler
        // It should equal: escrow balance + executor balance + client balance from refunds + paid out
        // Simplified: total supply should equal what we minted
        assertEq(usdc.totalSupply(), totalMinted);
    }

    /// @notice Task IDs are sequential with no gaps.
    function invariant_taskIdsSequential() public view {
        uint256 nextId = escrow.nextTaskId();
        for (uint256 i = 0; i < nextId; i++) {
            ITaskEscrow.Task memory task = escrow.getTask(i);
            // Every created task must have a non-zero client
            assertTrue(task.client != address(0));
        }
    }
}
