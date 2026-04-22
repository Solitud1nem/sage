// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskEscrow} from "../../src/TaskEscrow.sol";
import {ITaskEscrow} from "../../src/interfaces/ITaskEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TaskEscrowFuzzTest
 * @notice Property-based fuzz tests for TaskEscrow.
 *         Explores random amount, deadline, and timestamp combinations.
 */
contract TaskEscrowFuzzTest is Test {
    TaskEscrow public escrow;
    MockUSDC public usdc;

    uint256 internal clientKey = 0xA11CE;
    uint256 internal executorKey = 0xB0B;
    address public clientAddr;
    address public executorAddr;

    function setUp() public {
        clientAddr = vm.addr(clientKey);
        executorAddr = vm.addr(executorKey);

        usdc = new MockUSDC();
        escrow = new TaskEscrow(IERC20(address(usdc)));
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

    // ───────── Fuzz: createTask with random amounts ─────────

    function testFuzz_createTask_locksExactAmount(uint256 amount) public {
        // Bound to reasonable USDC range: 1 unit to 1B USDC
        amount = bound(amount, 1, 1_000_000_000_000_000); // up to 1B USDC (6 dec)

        usdc.mint(clientAddr, amount);
        ITaskEscrow.PermitData memory permit = _permit(amount);

        uint256 clientBefore = usdc.balanceOf(clientAddr);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            executorAddr,
            uint64(block.timestamp + 3600),
            amount,
            "ipfs://QmSpec",
            permit
        );

        // Invariant: escrow balance == locked amount
        assertEq(usdc.balanceOf(address(escrow)), amount);
        // Invariant: client lost exactly `amount`
        assertEq(usdc.balanceOf(clientAddr), clientBefore - amount);
        // Invariant: task recorded correctly
        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(task.amount, amount);
        assertEq(task.client, clientAddr);
        assertEq(task.executor, executorAddr);
    }

    // ───────── Fuzz: full cycle preserves total supply ─────────

    function testFuzz_fullCycle_preservesSupply(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000_000_000);

        usdc.mint(clientAddr, amount);
        uint256 totalSupply = usdc.totalSupply();

        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            executorAddr,
            uint64(block.timestamp + 3600),
            amount,
            "ipfs://QmSpec",
            permit
        );

        vm.prank(executorAddr);
        escrow.acceptTask(taskId);

        vm.prank(executorAddr);
        escrow.completeTask(taskId, "ipfs://QmResult");

        vm.prank(clientAddr);
        escrow.approvePayment(taskId);

        // Invariant: total supply unchanged (no mint/burn during escrow)
        assertEq(usdc.totalSupply(), totalSupply);
        // Invariant: escrow holds nothing
        assertEq(usdc.balanceOf(address(escrow)), 0);
        // Invariant: executor received exactly `amount`
        assertEq(usdc.balanceOf(executorAddr), amount);
    }

    // ───────── Fuzz: refund returns exact amount to client ─────────

    function testFuzz_refundExpired_returnsExactAmount(uint256 amount, uint64 deadlineOffset) public {
        amount = bound(amount, 1, 1_000_000_000_000_000);
        deadlineOffset = uint64(bound(deadlineOffset, 1, 365 days));

        usdc.mint(clientAddr, amount);

        uint64 deadline = uint64(block.timestamp) + deadlineOffset;
        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(executorAddr, deadline, amount, "ipfs://QmSpec", permit);

        uint256 clientBefore = usdc.balanceOf(clientAddr);

        // Warp past deadline
        vm.warp(uint256(deadline) + 1);

        escrow.refundExpired(taskId);

        // Invariant: client got back exactly `amount`
        assertEq(usdc.balanceOf(clientAddr), clientBefore + amount);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ───────── Fuzz: auto-release works after any grace period delay ─────────

    function testFuzz_autoRelease_afterGracePeriod(uint256 amount, uint256 extraDelay) public {
        amount = bound(amount, 1, 1_000_000_000_000_000);
        extraDelay = bound(extraDelay, 1, 365 days);

        usdc.mint(clientAddr, amount);
        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            executorAddr,
            uint64(block.timestamp + 365 days),
            amount,
            "ipfs://QmSpec",
            permit
        );

        vm.prank(executorAddr);
        escrow.acceptTask(taskId);

        vm.prank(executorAddr);
        escrow.completeTask(taskId, "ipfs://QmResult");

        uint256 completedAt = block.timestamp;

        // Warp past grace period + extra random delay
        vm.warp(completedAt + escrow.GRACE_PERIOD() + extraDelay);

        vm.prank(executorAddr);
        escrow.claimAutoRelease(taskId);

        assertEq(usdc.balanceOf(executorAddr), amount);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ───────── Fuzz: cannot accept after deadline ─────────

    function testFuzz_acceptTask_revertsAfterDeadline(uint64 deadlineOffset, uint256 warpExtra) public {
        deadlineOffset = uint64(bound(deadlineOffset, 1, 365 days));
        warpExtra = bound(warpExtra, 0, 365 days);

        uint256 amount = 1_000_000;
        usdc.mint(clientAddr, amount);

        uint64 deadline = uint64(block.timestamp) + deadlineOffset;
        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(executorAddr, deadline, amount, "ipfs://QmSpec", permit);

        // Warp to deadline or beyond
        vm.warp(uint256(deadline) + warpExtra);

        vm.prank(executorAddr);
        vm.expectRevert(ITaskEscrow.DeadlinePast.selector);
        escrow.acceptTask(taskId);
    }

    // ───────── Fuzz: cannot auto-release before grace period ─────────

    function testFuzz_autoRelease_revertsBeforeGrace(uint256 earlyWarp) public {
        earlyWarp = bound(earlyWarp, 0, escrow.GRACE_PERIOD() - 1);

        uint256 amount = 1_000_000;
        usdc.mint(clientAddr, amount);
        ITaskEscrow.PermitData memory permit = _permit(amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            executorAddr,
            uint64(block.timestamp + 3600),
            amount,
            "ipfs://QmSpec",
            permit
        );

        vm.prank(executorAddr);
        escrow.acceptTask(taskId);
        vm.prank(executorAddr);
        escrow.completeTask(taskId, "ipfs://QmResult");

        vm.warp(block.timestamp + earlyWarp);

        vm.prank(executorAddr);
        vm.expectRevert(ITaskEscrow.GracePeriodNotElapsed.selector);
        escrow.claimAutoRelease(taskId);
    }
}
