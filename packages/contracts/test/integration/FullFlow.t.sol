// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {TaskEscrow} from "../../src/TaskEscrow.sol";
import {IAgentRegistry} from "../../src/interfaces/IAgentRegistry.sol";
import {ITaskEscrow} from "../../src/interfaces/ITaskEscrow.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FullFlowTest
 * @notice End-to-end integration test simulating a real Sage workflow:
 *         1. Register agents in AgentRegistry
 *         2. Client creates escrow task with USDC permit
 *         3. Executor accepts, completes
 *         4. Client approves payment
 *         Also tests: auto-release path, dispute path, expiry/refund path.
 */
contract FullFlowTest is Test {
    AgentRegistry public registry;
    TaskEscrow public escrow;
    MockUSDC public usdc;

    address public owner = makeAddr("owner");

    uint256 internal clientKey = 0xC11E47;
    uint256 internal summarizerKey = 0x50AA1;
    uint256 internal translatorKey = 0x72A45;

    address public clientAddr;
    address public summarizer;
    address public translator;

    function setUp() public {
        clientAddr = vm.addr(clientKey);
        summarizer = vm.addr(summarizerKey);
        translator = vm.addr(translatorKey);

        usdc = new MockUSDC();
        registry = new AgentRegistry(owner);
        escrow = new TaskEscrow(IERC20(address(usdc)));

        // Fund client with 10 USDC
        usdc.mint(clientAddr, 10_000_000);
    }

    function _permit(uint256 signerKey, uint256 value)
        internal
        view
        returns (ITaskEscrow.PermitData memory)
    {
        address signer = vm.addr(signerKey);
        bytes32 domainSeparator = usdc.DOMAIN_SEPARATOR();
        bytes32 permitTypehash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        uint256 nonce = usdc.nonces(signer);
        uint256 deadline = block.timestamp + 3600;

        bytes32 structHash =
            keccak256(abi.encode(permitTypehash, signer, address(escrow), value, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        return ITaskEscrow.PermitData({value: value, deadline: deadline, v: v, r: r, s: s});
    }

    // ───────── Happy path: Orchestrator → Summarizer → Translator ─────────

    function test_fullFlow_happyPath() public {
        // Step 1: Register agents
        vm.prank(summarizer);
        registry.registerAgent("https://summarizer.sage.dev");
        vm.prank(translator);
        registry.registerAgent("https://translator.sage.dev");

        // Verify registration
        IAgentRegistry.Agent memory sumAgent = registry.getAgent(summarizer);
        assertTrue(sumAgent.active);
        assertEq(sumAgent.endpoint, "https://summarizer.sage.dev");

        // Step 2: Client creates task for Summarizer (1 USDC)
        uint256 amount1 = 1_000_000;
        ITaskEscrow.PermitData memory permit1 = _permit(clientKey, amount1);

        vm.prank(clientAddr);
        uint256 taskId1 = escrow.createTask(
            summarizer,
            uint64(block.timestamp + 3600),
            amount1,
            "ipfs://QmSummarizeSpec",
            permit1
        );

        assertEq(usdc.balanceOf(address(escrow)), amount1);
        assertEq(usdc.balanceOf(clientAddr), 10_000_000 - amount1);

        // Step 3: Summarizer accepts
        vm.prank(summarizer);
        escrow.acceptTask(taskId1);

        // Step 4: Summarizer completes
        vm.prank(summarizer);
        escrow.completeTask(taskId1, "ipfs://QmSummaryResult");

        // Step 5: Client approves — USDC goes to summarizer
        vm.prank(clientAddr);
        escrow.approvePayment(taskId1);

        assertEq(usdc.balanceOf(summarizer), amount1);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        ITaskEscrow.Task memory task1 = escrow.getTask(taskId1);
        assertEq(uint8(task1.status), uint8(ITaskEscrow.TaskStatus.Paid));
        assertEq(task1.resultUri, "ipfs://QmSummaryResult");

        // Step 6: Client creates task for Translator (2 USDC)
        uint256 amount2 = 2_000_000;
        ITaskEscrow.PermitData memory permit2 = _permit(clientKey, amount2);

        vm.prank(clientAddr);
        uint256 taskId2 = escrow.createTask(
            translator,
            uint64(block.timestamp + 3600),
            amount2,
            "ipfs://QmTranslateSpec",
            permit2
        );

        // Step 7: Translator accepts + completes + client approves
        vm.prank(translator);
        escrow.acceptTask(taskId2);

        vm.prank(translator);
        escrow.completeTask(taskId2, "ipfs://QmTranslationResult");

        vm.prank(clientAddr);
        escrow.approvePayment(taskId2);

        // Final assertions
        assertEq(usdc.balanceOf(summarizer), amount1);      // 1 USDC
        assertEq(usdc.balanceOf(translator), amount2);       // 2 USDC
        assertEq(usdc.balanceOf(clientAddr), 10_000_000 - amount1 - amount2); // 7 USDC
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.nextTaskId(), 2);
    }

    // ───────── Auto-release path ─────────

    function test_fullFlow_autoRelease() public {
        uint256 amount = 1_000_000;
        ITaskEscrow.PermitData memory permit = _permit(clientKey, amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            summarizer,
            uint64(block.timestamp + 3600),
            amount,
            "ipfs://QmSpec",
            permit
        );

        vm.prank(summarizer);
        escrow.acceptTask(taskId);

        vm.prank(summarizer);
        escrow.completeTask(taskId, "ipfs://QmResult");

        // Client doesn't respond — grace period passes
        vm.warp(block.timestamp + escrow.GRACE_PERIOD() + 1);

        // Executor claims auto-release
        vm.prank(summarizer);
        escrow.claimAutoRelease(taskId);

        assertEq(usdc.balanceOf(summarizer), amount);
        assertEq(uint8(escrow.getTask(taskId).status), uint8(ITaskEscrow.TaskStatus.Paid));
    }

    // ───────── Dispute path ─────────

    function test_fullFlow_dispute() public {
        uint256 amount = 1_000_000;
        ITaskEscrow.PermitData memory permit = _permit(clientKey, amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            summarizer,
            uint64(block.timestamp + 3600),
            amount,
            "ipfs://QmSpec",
            permit
        );

        vm.prank(summarizer);
        escrow.acceptTask(taskId);

        vm.prank(summarizer);
        escrow.completeTask(taskId, "ipfs://QmBadResult");

        // Client disputes
        vm.prank(clientAddr);
        escrow.disputeTask(taskId, "Result quality insufficient");

        assertEq(uint8(escrow.getTask(taskId).status), uint8(ITaskEscrow.TaskStatus.Disputed));

        // USDC still locked in escrow (v2 — no arbitration, manual resolution)
        assertEq(usdc.balanceOf(address(escrow)), amount);
        assertEq(usdc.balanceOf(summarizer), 0);
    }

    // ───────── Expiry/refund path ─────────

    function test_fullFlow_expiry() public {
        uint256 amount = 1_000_000;
        uint64 deadline = uint64(block.timestamp + 1800); // 30 min
        ITaskEscrow.PermitData memory permit = _permit(clientKey, amount);

        vm.prank(clientAddr);
        uint256 taskId = escrow.createTask(
            summarizer,
            deadline,
            amount,
            "ipfs://QmSpec",
            permit
        );

        // Nobody accepts — deadline passes
        vm.warp(deadline + 1);

        // Anyone can trigger refund
        vm.prank(makeAddr("random"));
        escrow.refundExpired(taskId);

        assertEq(usdc.balanceOf(clientAddr), 10_000_000); // full refund
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(escrow.getTask(taskId).status), uint8(ITaskEscrow.TaskStatus.Expired));
    }

    // ───────── Multiple concurrent tasks ─────────

    function test_fullFlow_concurrentTasks() public {
        uint256 amount1 = 1_000_000;
        uint256 amount2 = 2_000_000;

        // Create two tasks simultaneously
        ITaskEscrow.PermitData memory permit1 = _permit(clientKey, amount1);
        vm.prank(clientAddr);
        uint256 tid1 = escrow.createTask(summarizer, uint64(block.timestamp + 3600), amount1, "ipfs://QmA", permit1);

        ITaskEscrow.PermitData memory permit2 = _permit(clientKey, amount2);
        vm.prank(clientAddr);
        uint256 tid2 = escrow.createTask(translator, uint64(block.timestamp + 3600), amount2, "ipfs://QmB", permit2);

        assertEq(usdc.balanceOf(address(escrow)), amount1 + amount2);

        // Complete task 1
        vm.prank(summarizer);
        escrow.acceptTask(tid1);
        vm.prank(summarizer);
        escrow.completeTask(tid1, "ipfs://QmResultA");
        vm.prank(clientAddr);
        escrow.approvePayment(tid1);

        // Task 2 expires
        vm.warp(block.timestamp + 3601);
        escrow.refundExpired(tid2);

        // Summarizer got paid, client got refund for task 2
        assertEq(usdc.balanceOf(summarizer), amount1);
        assertEq(usdc.balanceOf(clientAddr), 10_000_000 - amount1);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }
}
