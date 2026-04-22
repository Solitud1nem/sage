// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {ITaskEscrow} from "../src/interfaces/ITaskEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TaskEscrowTest is Test {
    TaskEscrow public escrow;
    MockUSDC public usdc;

    uint256 internal clientKey = 0xA11CE;
    uint256 internal executorKey = 0xB0B;

    address public client;
    address public executor;
    address public anyone = makeAddr("anyone");

    uint256 constant AMOUNT = 1_000_000; // 1 USDC
    uint64 constant DEADLINE_OFFSET = 3600; // 1 hour from now
    string constant SPEC_URI = "ipfs://QmSpec";
    string constant RESULT_URI = "ipfs://QmResult";

    function setUp() public {
        client = vm.addr(clientKey);
        executor = vm.addr(executorKey);

        usdc = new MockUSDC();
        escrow = new TaskEscrow(IERC20(address(usdc)));

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
        returns (ITaskEscrow.PermitData memory)
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

        return ITaskEscrow.PermitData({value: value, deadline: permitDeadline, v: v, r: r, s: s});
    }

    function _createTask() internal returns (uint256 taskId) {
        ITaskEscrow.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);
        vm.prank(client);
        taskId = escrow.createTask(executor, _deadline(), AMOUNT, SPEC_URI, permit);
    }

    function _createAndAccept() internal returns (uint256 taskId) {
        taskId = _createTask();
        vm.prank(executor);
        escrow.acceptTask(taskId);
    }

    function _createAcceptComplete() internal returns (uint256 taskId) {
        taskId = _createAndAccept();
        vm.prank(executor);
        escrow.completeTask(taskId, RESULT_URI);
    }

    // ───────── createTask ─────────

    function test_createTask_happyPath() public {
        uint256 balanceBefore = usdc.balanceOf(client);

        ITaskEscrow.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);

        vm.prank(client);
        vm.expectEmit(true, true, true, true);
        emit ITaskEscrow.TaskCreated(0, client, executor, AMOUNT, _deadline(), SPEC_URI);
        uint256 taskId = escrow.createTask(executor, _deadline(), AMOUNT, SPEC_URI, permit);

        assertEq(taskId, 0);
        assertEq(escrow.nextTaskId(), 1);
        assertEq(usdc.balanceOf(client), balanceBefore - AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(task.client, client);
        assertEq(task.executor, executor);
        assertEq(task.amount, AMOUNT);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Created));
        assertEq(task.specUri, SPEC_URI);
        assertEq(task.resultUri, "");
        assertEq(task.completedAt, 0);
    }

    function test_createTask_withPreApproval() public {
        // Pre-approve instead of permit
        vm.prank(client);
        usdc.approve(address(escrow), AMOUNT);

        // Pass dummy permit data — should still work via try/catch
        ITaskEscrow.PermitData memory permit =
            ITaskEscrow.PermitData({value: 0, deadline: 0, v: 0, r: bytes32(0), s: bytes32(0)});

        vm.prank(client);
        uint256 taskId = escrow.createTask(executor, _deadline(), AMOUNT, SPEC_URI, permit);
        assertEq(taskId, 0);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
    }

    function test_createTask_reverts_ZeroExecutor() public {
        ITaskEscrow.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);
        vm.prank(client);
        vm.expectRevert(ITaskEscrow.ZeroExecutor.selector);
        escrow.createTask(address(0), _deadline(), AMOUNT, SPEC_URI, permit);
    }

    function test_createTask_reverts_ZeroAmount() public {
        ITaskEscrow.PermitData memory permit = _permitData(clientKey, 0, block.timestamp + 3600);
        vm.prank(client);
        vm.expectRevert(ITaskEscrow.ZeroAmount.selector);
        escrow.createTask(executor, _deadline(), 0, SPEC_URI, permit);
    }

    function test_createTask_reverts_DeadlinePast() public {
        ITaskEscrow.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);
        vm.prank(client);
        vm.expectRevert(ITaskEscrow.DeadlinePast.selector);
        escrow.createTask(executor, uint64(block.timestamp), AMOUNT, SPEC_URI, permit);
    }

    function test_createTask_reverts_EmptySpecUri() public {
        ITaskEscrow.PermitData memory permit = _permitData(clientKey, AMOUNT, block.timestamp + 3600);
        vm.prank(client);
        vm.expectRevert(ITaskEscrow.EmptySpecUri.selector);
        escrow.createTask(executor, _deadline(), AMOUNT, "", permit);
    }

    // ───────── acceptTask ─────────

    function test_acceptTask_happyPath() public {
        uint256 taskId = _createTask();

        vm.prank(executor);
        vm.expectEmit(true, true, false, false);
        emit ITaskEscrow.TaskAccepted(taskId, executor);
        escrow.acceptTask(taskId);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Accepted));
    }

    function test_acceptTask_reverts_Unauthorized() public {
        uint256 taskId = _createTask();
        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.Unauthorized.selector);
        escrow.acceptTask(taskId);
    }

    function test_acceptTask_reverts_InvalidStatus() public {
        uint256 taskId = _createAndAccept();
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Accepted, ITaskEscrow.TaskStatus.Created
            )
        );
        escrow.acceptTask(taskId);
    }

    function test_acceptTask_reverts_DeadlinePast() public {
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        vm.prank(executor);
        vm.expectRevert(ITaskEscrow.DeadlinePast.selector);
        escrow.acceptTask(taskId);
    }

    function test_acceptTask_reverts_TaskNotFound() public {
        vm.prank(executor);
        vm.expectRevert(ITaskEscrow.TaskNotFound.selector);
        escrow.acceptTask(999);
    }

    // ───────── completeTask ─────────

    function test_completeTask_happyPath() public {
        uint256 taskId = _createAndAccept();

        vm.prank(executor);
        vm.expectEmit(true, false, false, true);
        emit ITaskEscrow.TaskCompleted(taskId, RESULT_URI);
        escrow.completeTask(taskId, RESULT_URI);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Completed));
        assertEq(task.resultUri, RESULT_URI);
        assertEq(task.completedAt, block.timestamp);
    }

    function test_completeTask_reverts_Unauthorized() public {
        uint256 taskId = _createAndAccept();
        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.Unauthorized.selector);
        escrow.completeTask(taskId, RESULT_URI);
    }

    function test_completeTask_reverts_InvalidStatus_fromCreated() public {
        uint256 taskId = _createTask();
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Created, ITaskEscrow.TaskStatus.Accepted
            )
        );
        escrow.completeTask(taskId, RESULT_URI);
    }

    function test_completeTask_reverts_EmptyResultUri() public {
        uint256 taskId = _createAndAccept();
        vm.prank(executor);
        vm.expectRevert(ITaskEscrow.EmptyResultUri.selector);
        escrow.completeTask(taskId, "");
    }

    // ───────── approvePayment ─────────

    function test_approvePayment_happyPath() public {
        uint256 taskId = _createAcceptComplete();
        uint256 executorBalanceBefore = usdc.balanceOf(executor);

        vm.prank(client);
        vm.expectEmit(true, false, false, false);
        emit ITaskEscrow.TaskPaid(taskId);
        escrow.approvePayment(taskId);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Paid));
        assertEq(usdc.balanceOf(executor), executorBalanceBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_approvePayment_reverts_Unauthorized() public {
        uint256 taskId = _createAcceptComplete();
        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.Unauthorized.selector);
        escrow.approvePayment(taskId);
    }

    function test_approvePayment_reverts_InvalidStatus() public {
        uint256 taskId = _createAndAccept();
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Accepted, ITaskEscrow.TaskStatus.Completed
            )
        );
        escrow.approvePayment(taskId);
    }

    // ───────── disputeTask ─────────

    function test_disputeTask_happyPath() public {
        uint256 taskId = _createAcceptComplete();

        vm.prank(client);
        vm.expectEmit(true, false, false, true);
        emit ITaskEscrow.TaskDisputed(taskId, "bad result");
        escrow.disputeTask(taskId, "bad result");

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Disputed));
    }

    function test_disputeTask_reverts_Unauthorized() public {
        uint256 taskId = _createAcceptComplete();
        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.Unauthorized.selector);
        escrow.disputeTask(taskId, "reason");
    }

    function test_disputeTask_reverts_EmptyReason() public {
        uint256 taskId = _createAcceptComplete();
        vm.prank(client);
        vm.expectRevert(ITaskEscrow.EmptyReason.selector);
        escrow.disputeTask(taskId, "");
    }

    function test_disputeTask_reverts_InvalidStatus() public {
        uint256 taskId = _createAndAccept();
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Accepted, ITaskEscrow.TaskStatus.Completed
            )
        );
        escrow.disputeTask(taskId, "reason");
    }

    function test_disputeTask_preventsAutoRelease() public {
        uint256 taskId = _createAcceptComplete();

        vm.prank(client);
        escrow.disputeTask(taskId, "bad result");

        // Even after grace period, auto-release should fail
        vm.warp(block.timestamp + escrow.GRACE_PERIOD() + 1);
        vm.prank(executor);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Disputed, ITaskEscrow.TaskStatus.Completed
            )
        );
        escrow.claimAutoRelease(taskId);
    }

    // ───────── refundExpired ─────────

    function test_refundExpired_fromCreated() public {
        uint256 taskId = _createTask();
        uint256 clientBalanceBefore = usdc.balanceOf(client);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        vm.prank(anyone);
        vm.expectEmit(true, false, false, false);
        emit ITaskEscrow.TaskExpired(taskId);
        escrow.refundExpired(taskId);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Expired));
        assertEq(usdc.balanceOf(client), clientBalanceBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_refundExpired_fromAccepted() public {
        uint256 taskId = _createAndAccept();

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        vm.prank(anyone);
        escrow.refundExpired(taskId);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Expired));
    }

    function test_refundExpired_reverts_DeadlineNotPassed() public {
        uint256 taskId = _createTask();
        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.DeadlineNotPassed.selector);
        escrow.refundExpired(taskId);
    }

    function test_refundExpired_reverts_InvalidStatus_fromCompleted() public {
        uint256 taskId = _createAcceptComplete();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        vm.prank(anyone);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Completed, ITaskEscrow.TaskStatus.Created
            )
        );
        escrow.refundExpired(taskId);
    }

    function test_refundExpired_reverts_InvalidStatus_fromPaid() public {
        uint256 taskId = _createAcceptComplete();
        vm.prank(client);
        escrow.approvePayment(taskId);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        vm.prank(anyone);
        vm.expectRevert(
            abi.encodeWithSelector(
                ITaskEscrow.InvalidStatus.selector, ITaskEscrow.TaskStatus.Paid, ITaskEscrow.TaskStatus.Created
            )
        );
        escrow.refundExpired(taskId);
    }

    // ───────── claimAutoRelease ─────────

    function test_claimAutoRelease_happyPath() public {
        uint256 taskId = _createAcceptComplete();
        uint256 executorBalanceBefore = usdc.balanceOf(executor);

        vm.warp(block.timestamp + escrow.GRACE_PERIOD() + 1);

        vm.prank(executor);
        vm.expectEmit(true, false, false, false);
        emit ITaskEscrow.TaskPaid(taskId);
        escrow.claimAutoRelease(taskId);

        ITaskEscrow.Task memory task = escrow.getTask(taskId);
        assertEq(uint8(task.status), uint8(ITaskEscrow.TaskStatus.Paid));
        assertEq(usdc.balanceOf(executor), executorBalanceBefore + AMOUNT);
    }

    function test_claimAutoRelease_reverts_GracePeriodNotElapsed() public {
        uint256 taskId = _createAcceptComplete();

        vm.prank(executor);
        vm.expectRevert(ITaskEscrow.GracePeriodNotElapsed.selector);
        escrow.claimAutoRelease(taskId);
    }

    function test_claimAutoRelease_reverts_Unauthorized() public {
        uint256 taskId = _createAcceptComplete();
        vm.warp(block.timestamp + escrow.GRACE_PERIOD() + 1);

        vm.prank(anyone);
        vm.expectRevert(ITaskEscrow.Unauthorized.selector);
        escrow.claimAutoRelease(taskId);
    }

    // ───────── getTask ─────────

    function test_getTask_nonExistent_returnsDefault() public view {
        ITaskEscrow.Task memory task = escrow.getTask(999);
        assertEq(task.client, address(0));
        assertEq(task.executor, address(0));
        assertEq(task.amount, 0);
    }

    // ───────── GRACE_PERIOD ─────────

    function test_gracePeriod_is300() public view {
        assertEq(escrow.GRACE_PERIOD(), 300);
    }
}
