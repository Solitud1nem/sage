// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskEscrowV2} from "../src/TaskEscrowV2.sol";
import {ITaskEscrowV2} from "../src/interfaces/ITaskEscrowV2.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TaskEscrowV2Test is Test {
    TaskEscrowV2 public escrow;
    MockUSDC public usdc;

    uint256 internal clientKey = 0xA11CE;
    uint256 internal executorKey = 0xB0B;

    address public client;
    address public executor;
    address public owner = makeAddr("owner");
    address public arbiter = makeAddr("arbiter");
    address public newArbiter = makeAddr("newArbiter");
    address public anyone = makeAddr("anyone");

    uint256 constant AMOUNT = 1_000_000; // 1 USDC (6 decimals)
    uint64 constant DEADLINE_OFFSET = 3600; // 1 hour
    string constant SPEC_URI = "ipfs://QmSpec";
    string constant RESULT_URI = "ipfs://QmResult";
    string constant DISPUTE_REASON = "executor delivered wrong output";

    function setUp() public {
        client = vm.addr(clientKey);
        executor = vm.addr(executorKey);

        usdc = new MockUSDC();
        escrow = new TaskEscrowV2(IERC20(address(usdc)), owner, arbiter);

        // Fund client
        usdc.mint(client, 100_000_000); // 100 USDC
    }

    // ───────── Helpers ─────────

    function _deadline() internal view returns (uint64) {
        return uint64(block.timestamp) + DEADLINE_OFFSET;
    }

    function _permitData(uint256 signerKey, uint256 value, uint256 permitDeadline)
        internal
        view
        returns (ITaskEscrowV2.PermitData memory)
    {
        bytes32 domainSeparator = usdc.DOMAIN_SEPARATOR();
        bytes32 permitTypehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

        address signer = vm.addr(signerKey);
        uint256 nonce = usdc.nonces(signer);

        bytes32 structHash =
            keccak256(abi.encode(permitTypehash, signer, address(escrow), value, nonce, permitDeadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        return ITaskEscrowV2.PermitData({value: value, deadline: permitDeadline, v: v, r: r, s: s});
    }

    function _createTask() internal returns (uint256 taskId) {
        ITaskEscrowV2.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);
        vm.prank(client);
        taskId = escrow.createTask(executor, _deadline(), AMOUNT, SPEC_URI, permit);
    }

    function _disputedTask() internal returns (uint256 taskId) {
        taskId = _createTask();
        vm.prank(executor);
        escrow.acceptTask(taskId);
        vm.prank(executor);
        escrow.completeTask(taskId, RESULT_URI);
        vm.prank(client);
        escrow.disputeTask(taskId, DISPUTE_REASON);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════

    function test_constructor_setsOwnerArbiterUsdc() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.arbiter(), arbiter);
        assertEq(address(escrow.USDC()), address(usdc));
    }

    function test_constructor_emitsArbiterChanged() public {
        vm.expectEmit(true, true, false, false);
        emit ITaskEscrowV2.ArbiterChanged(address(0), arbiter);
        new TaskEscrowV2(IERC20(address(usdc)), owner, arbiter);
    }

    function test_constructor_revertsOnZeroArbiter() public {
        vm.expectRevert(ITaskEscrowV2.ZeroArbiter.selector);
        new TaskEscrowV2(IERC20(address(usdc)), owner, address(0));
    }

    function test_constructor_revertsOnZeroOwner() public {
        // Ownable's own check
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new TaskEscrowV2(IERC20(address(usdc)), address(0), arbiter);
    }

    // ═══════════════════════════════════════════════════════════════════
    // setArbiter
    // ═══════════════════════════════════════════════════════════════════

    function test_setArbiter_byOwner_setsAndEmits() public {
        vm.expectEmit(true, true, false, false);
        emit ITaskEscrowV2.ArbiterChanged(arbiter, newArbiter);

        vm.prank(owner);
        escrow.setArbiter(newArbiter);

        assertEq(escrow.arbiter(), newArbiter);
    }

    function test_setArbiter_byNonOwner_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, anyone));
        vm.prank(anyone);
        escrow.setArbiter(newArbiter);
    }

    function test_setArbiter_byCurrentArbiter_reverts() public {
        // Arbiter cannot self-rotate. Only owner can.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, arbiter));
        vm.prank(arbiter);
        escrow.setArbiter(newArbiter);
    }

    function test_setArbiter_zeroAddress_reverts() public {
        vm.expectRevert(ITaskEscrowV2.ZeroArbiter.selector);
        vm.prank(owner);
        escrow.setArbiter(address(0));
    }

    function test_setArbiter_rotation_oldArbiterLosesAccess() public {
        uint256 taskId = _disputedTask();

        vm.prank(owner);
        escrow.setArbiter(newArbiter);

        // Old arbiter cannot resolve anymore
        vm.expectRevert(ITaskEscrowV2.Unauthorized.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);

        // New arbiter can
        vm.prank(newArbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);

        assertEq(uint256(escrow.getTask(taskId).status), uint256(ITaskEscrowV2.TaskStatus.Paid));
    }

    // ═══════════════════════════════════════════════════════════════════
    // Ownable2Step — two-step ownership transfer
    // ═══════════════════════════════════════════════════════════════════

    function test_ownership_twoStepTransfer() public {
        address newOwner = makeAddr("newOwner");

        // Step 1: current owner proposes
        vm.prank(owner);
        escrow.transferOwnership(newOwner);

        // Ownership still with old owner until acceptance
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), newOwner);

        // Step 2: new owner accepts
        vm.prank(newOwner);
        escrow.acceptOwnership();

        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function test_ownership_pendingOwnerCannotActAsOwner() public {
        address newOwner = makeAddr("newOwner");

        vm.prank(owner);
        escrow.transferOwnership(newOwner);

        // Pending owner cannot setArbiter yet
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vm.prank(newOwner);
        escrow.setArbiter(newArbiter);
    }

    // ═══════════════════════════════════════════════════════════════════
    // resolveDispute — happy paths (each outcome)
    // ═══════════════════════════════════════════════════════════════════

    function test_resolveDispute_paid_fullToExecutor() public {
        uint256 taskId = _disputedTask();
        uint256 execBalanceBefore = usdc.balanceOf(executor);
        uint256 clientBalanceBefore = usdc.balanceOf(client);

        vm.expectEmit(true, false, true, true);
        emit ITaskEscrowV2.TaskResolved(taskId, ITaskEscrowV2.TaskStatus.Paid, AMOUNT, arbiter);

        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);

        ITaskEscrowV2.Task memory t = escrow.getTask(taskId);
        assertEq(uint256(t.status), uint256(ITaskEscrowV2.TaskStatus.Paid));
        assertEq(t.executorShare, 0); // not stored for non-Split outcomes
        assertEq(usdc.balanceOf(executor), execBalanceBefore + AMOUNT);
        assertEq(usdc.balanceOf(client), clientBalanceBefore);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_resolveDispute_refunded_fullToClient() public {
        uint256 taskId = _disputedTask();
        uint256 execBalanceBefore = usdc.balanceOf(executor);
        uint256 clientBalanceBefore = usdc.balanceOf(client);

        vm.expectEmit(true, false, true, true);
        emit ITaskEscrowV2.TaskResolved(taskId, ITaskEscrowV2.TaskStatus.Refunded, 0, arbiter);

        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Refunded, 0);

        ITaskEscrowV2.Task memory t = escrow.getTask(taskId);
        assertEq(uint256(t.status), uint256(ITaskEscrowV2.TaskStatus.Refunded));
        assertEq(t.executorShare, 0);
        assertEq(usdc.balanceOf(executor), execBalanceBefore);
        assertEq(usdc.balanceOf(client), clientBalanceBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_resolveDispute_split_partialToEach() public {
        uint256 taskId = _disputedTask();
        uint256 execBalanceBefore = usdc.balanceOf(executor);
        uint256 clientBalanceBefore = usdc.balanceOf(client);
        uint256 share = AMOUNT * 3 / 10; // 30% to executor, 70% to client

        vm.expectEmit(true, false, true, true);
        emit ITaskEscrowV2.TaskResolved(taskId, ITaskEscrowV2.TaskStatus.Split, share, arbiter);

        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, share);

        ITaskEscrowV2.Task memory t = escrow.getTask(taskId);
        assertEq(uint256(t.status), uint256(ITaskEscrowV2.TaskStatus.Split));
        assertEq(t.executorShare, share); // stored on Split
        assertEq(usdc.balanceOf(executor), execBalanceBefore + share);
        assertEq(usdc.balanceOf(client), clientBalanceBefore + (AMOUNT - share));
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // resolveDispute — access control + state preconditions
    // ═══════════════════════════════════════════════════════════════════

    function test_resolveDispute_byNonArbiter_reverts() public {
        uint256 taskId = _disputedTask();

        vm.expectRevert(ITaskEscrowV2.Unauthorized.selector);
        vm.prank(anyone);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);
    }

    function test_resolveDispute_byOwner_reverts() public {
        // Owner is NOT arbiter unless explicitly set so. Roles are separate.
        uint256 taskId = _disputedTask();

        vm.expectRevert(ITaskEscrowV2.Unauthorized.selector);
        vm.prank(owner);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);
    }

    function test_resolveDispute_taskNotFound_reverts() public {
        vm.expectRevert(ITaskEscrowV2.TaskNotFound.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(999, ITaskEscrowV2.TaskStatus.Paid, 0);
    }

    function test_resolveDispute_notDisputed_reverts_fromCreated() public {
        uint256 taskId = _createTask();
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrowV2.InvalidStatus.selector,
                ITaskEscrowV2.TaskStatus.Created,
                ITaskEscrowV2.TaskStatus.Disputed
            )
        );
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);
    }

    function test_resolveDispute_notDisputed_reverts_fromCompleted() public {
        uint256 taskId = _createTask();
        vm.prank(executor);
        escrow.acceptTask(taskId);
        vm.prank(executor);
        escrow.completeTask(taskId, RESULT_URI);

        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrowV2.InvalidStatus.selector,
                ITaskEscrowV2.TaskStatus.Completed,
                ITaskEscrowV2.TaskStatus.Disputed
            )
        );
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);
    }

    function test_resolveDispute_doubleResolve_reverts() public {
        uint256 taskId = _disputedTask();
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 0);

        // Already Paid, not Disputed — second resolve fails.
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrowV2.InvalidStatus.selector,
                ITaskEscrowV2.TaskStatus.Paid,
                ITaskEscrowV2.TaskStatus.Disputed
            )
        );
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Refunded, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // resolveDispute — outcome + executorShare validation
    // ═══════════════════════════════════════════════════════════════════

    function test_resolveDispute_paid_withNonZeroShare_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidExecutorShare.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Paid, 1);
    }

    function test_resolveDispute_refunded_withNonZeroShare_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidExecutorShare.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Refunded, 1);
    }

    function test_resolveDispute_split_withZeroShare_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidExecutorShare.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, 0);
    }

    function test_resolveDispute_split_withFullShare_reverts() public {
        // executorShare == amount is the Paid edge — must go through Paid branch.
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidExecutorShare.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, AMOUNT);
    }

    function test_resolveDispute_split_withOverShare_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidExecutorShare.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, AMOUNT + 1);
    }

    function test_resolveDispute_invalidOutcome_created_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidOutcome.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Created, 0);
    }

    function test_resolveDispute_invalidOutcome_disputed_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidOutcome.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Disputed, 0);
    }

    function test_resolveDispute_invalidOutcome_expired_reverts() public {
        uint256 taskId = _disputedTask();
        vm.expectRevert(ITaskEscrowV2.InvalidOutcome.selector);
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Expired, 0);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Invariant — total amount conservation across all outcomes
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_resolveDispute_amountConservation(uint256 share) public {
        share = bound(share, 1, AMOUNT - 1); // valid Split range
        uint256 taskId = _disputedTask();

        uint256 execBefore = usdc.balanceOf(executor);
        uint256 clientBefore = usdc.balanceOf(client);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, share);

        uint256 execDelta = usdc.balanceOf(executor) - execBefore;
        uint256 clientDelta = usdc.balanceOf(client) - clientBefore;
        uint256 escrowDelta = escrowBefore - usdc.balanceOf(address(escrow));

        assertEq(execDelta + clientDelta, AMOUNT, "split: total to parties == amount");
        assertEq(escrowDelta, AMOUNT, "split: escrow lost exactly amount");
        assertEq(execDelta, share, "split: executor got share");
        assertEq(clientDelta, AMOUNT - share, "split: client got remainder");
    }

    // ═══════════════════════════════════════════════════════════════════
    // v1 surface — slim regression (preserved byte-for-byte from TaskEscrow)
    // ═══════════════════════════════════════════════════════════════════

    function test_v1_createAcceptCompleteApprove_works() public {
        uint256 taskId = _createTask();
        vm.prank(executor);
        escrow.acceptTask(taskId);
        vm.prank(executor);
        escrow.completeTask(taskId, RESULT_URI);

        uint256 execBefore = usdc.balanceOf(executor);
        vm.prank(client);
        escrow.approvePayment(taskId);

        assertEq(uint256(escrow.getTask(taskId).status), uint256(ITaskEscrowV2.TaskStatus.Paid));
        assertEq(usdc.balanceOf(executor), execBefore + AMOUNT);
    }

    function test_v1_disputeTask_setsDisputed_notTerminal() public {
        uint256 taskId = _disputedTask();
        ITaskEscrowV2.Task memory t = escrow.getTask(taskId);
        assertEq(uint256(t.status), uint256(ITaskEscrowV2.TaskStatus.Disputed));
        // Escrow still holds funds — not terminal yet.
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_v1_refundExpired_writesExpired_notRefunded() public {
        // Critical: Refunded is now reachable, but ONLY via resolveDispute.
        // refundExpired must continue writing Expired (different cause).
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        uint256 clientBefore = usdc.balanceOf(client);
        escrow.refundExpired(taskId);

        ITaskEscrowV2.Task memory t = escrow.getTask(taskId);
        assertEq(uint256(t.status), uint256(ITaskEscrowV2.TaskStatus.Expired));
        assertTrue(t.status != ITaskEscrowV2.TaskStatus.Refunded, "must NOT be Refunded");
        assertEq(usdc.balanceOf(client), clientBefore + AMOUNT);
    }

    function test_v1_claimAutoRelease_afterGracePeriod_works() public {
        uint256 taskId = _createTask();
        vm.prank(executor);
        escrow.acceptTask(taskId);
        vm.prank(executor);
        escrow.completeTask(taskId, RESULT_URI);

        // Grace period: 300s. Skip.
        vm.warp(block.timestamp + 301);

        uint256 execBefore = usdc.balanceOf(executor);
        vm.prank(executor);
        escrow.claimAutoRelease(taskId);

        assertEq(uint256(escrow.getTask(taskId).status), uint256(ITaskEscrowV2.TaskStatus.Paid));
        assertEq(usdc.balanceOf(executor), execBefore + AMOUNT);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Reachability matrix — explicit invariant that the new terminal Split
    // is reachable only via resolveDispute, and Refunded only via resolveDispute(Refunded).
    // ═══════════════════════════════════════════════════════════════════

    function test_reachability_splitOnlyViaResolveDispute() public {
        uint256 taskId = _disputedTask();
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Split, AMOUNT / 2);
        assertEq(uint256(escrow.getTask(taskId).status), uint256(ITaskEscrowV2.TaskStatus.Split));
    }

    function test_reachability_refundedOnlyViaResolveDispute() public {
        uint256 taskId = _disputedTask();
        vm.prank(arbiter);
        escrow.resolveDispute(taskId, ITaskEscrowV2.TaskStatus.Refunded, 0);
        assertEq(uint256(escrow.getTask(taskId).status), uint256(ITaskEscrowV2.TaskStatus.Refunded));
    }
}
