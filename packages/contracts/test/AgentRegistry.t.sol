// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {IAgentRegistry} from "../src/interfaces/IAgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry public registry;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    string constant ENDPOINT_A = "https://alice-agent.com";
    string constant ENDPOINT_B = "https://bob-agent.com";
    string constant ENDPOINT_C = "https://carol-agent.com";
    string constant ENDPOINT_UPDATED = "https://alice-agent-v2.com";

    function setUp() public {
        registry = new AgentRegistry(owner);
    }

    // ───────── registerAgent ─────────

    function test_registerAgent_happyPath() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IAgentRegistry.AgentRegistered(alice, ENDPOINT_A);
        registry.registerAgent(ENDPOINT_A);

        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.owner, alice);
        assertEq(agent.endpoint, ENDPOINT_A);
        assertEq(agent.registeredAt, block.timestamp);
        assertTrue(agent.active);
        assertEq(registry.agentCount(), 1);
    }

    function test_registerAgent_reverts_AlreadyRegistered() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.AlreadyRegistered.selector);
        registry.registerAgent(ENDPOINT_A);
    }

    function test_registerAgent_reverts_EmptyEndpoint() public {
        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.EmptyEndpoint.selector);
        registry.registerAgent("");
    }

    function test_registerAgent_reverts_whenPaused() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.registerAgent(ENDPOINT_A);
    }

    // ───────── updateProfile ─────────

    function test_updateProfile_happyPath() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IAgentRegistry.AgentUpdated(alice, ENDPOINT_UPDATED);
        registry.updateProfile(ENDPOINT_UPDATED);

        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.endpoint, ENDPOINT_UPDATED);
    }

    function test_updateProfile_reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotRegistered.selector);
        registry.updateProfile(ENDPOINT_UPDATED);
    }

    function test_updateProfile_reverts_EmptyEndpoint() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.EmptyEndpoint.selector);
        registry.updateProfile("");
    }

    function test_updateProfile_reverts_whenPaused() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.updateProfile(ENDPOINT_UPDATED);
    }

    // ───────── pauseAgent ─────────

    function test_pauseAgent_happyPath() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit IAgentRegistry.AgentPaused(alice);
        registry.pauseAgent();

        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertFalse(agent.active);
    }

    function test_pauseAgent_reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotRegistered.selector);
        registry.pauseAgent();
    }

    function test_pauseAgent_reverts_AlreadyInState() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        registry.pauseAgent();

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.AlreadyInState.selector);
        registry.pauseAgent();
    }

    function test_pauseAgent_worksEvenWhenGloballyPaused() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(owner);
        registry.pause();

        // Agent can still pause themselves during emergency
        vm.prank(alice);
        registry.pauseAgent();

        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertFalse(agent.active);
    }

    // ───────── resumeAgent ─────────

    function test_resumeAgent_happyPath() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        registry.pauseAgent();

        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit IAgentRegistry.AgentResumed(alice);
        registry.resumeAgent();

        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertTrue(agent.active);
    }

    function test_resumeAgent_reverts_NotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.NotRegistered.selector);
        registry.resumeAgent();
    }

    function test_resumeAgent_reverts_AlreadyInState() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        vm.expectRevert(IAgentRegistry.AlreadyInState.selector);
        registry.resumeAgent();
    }

    function test_resumeAgent_reverts_whenPaused() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        vm.prank(alice);
        registry.pauseAgent();

        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.resumeAgent();
    }

    // ───────── getAgent ─────────

    function test_getAgent_unregistered_returnsZeroOwner() public view {
        IAgentRegistry.Agent memory agent = registry.getAgent(alice);
        assertEq(agent.owner, address(0));
        assertEq(agent.endpoint, "");
        assertEq(agent.registeredAt, 0);
        assertFalse(agent.active);
    }

    // ───────── listAgents ─────────

    function test_listAgents_empty() public view {
        (IAgentRegistry.Agent[] memory agents, uint256 nextCursor) = registry.listAgents(0, 10);
        assertEq(agents.length, 0);
        assertEq(nextCursor, 0);
    }

    function test_listAgents_allAgents() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);
        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B);
        vm.prank(carol);
        registry.registerAgent(ENDPOINT_C);

        (IAgentRegistry.Agent[] memory agents, uint256 nextCursor) = registry.listAgents(0, 10);
        assertEq(agents.length, 3);
        assertEq(agents[0].owner, alice);
        assertEq(agents[1].owner, bob);
        assertEq(agents[2].owner, carol);
        assertEq(nextCursor, 0); // no more pages
    }

    function test_listAgents_pagination() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);
        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B);
        vm.prank(carol);
        registry.registerAgent(ENDPOINT_C);

        // Page 1: first 2
        (IAgentRegistry.Agent[] memory page1, uint256 cursor1) = registry.listAgents(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].owner, alice);
        assertEq(page1[1].owner, bob);
        assertEq(cursor1, 2);

        // Page 2: remaining 1
        (IAgentRegistry.Agent[] memory page2, uint256 cursor2) = registry.listAgents(cursor1, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0].owner, carol);
        assertEq(cursor2, 0); // no more pages
    }

    function test_listAgents_cursorBeyondTotal() public {
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);

        (IAgentRegistry.Agent[] memory agents, uint256 nextCursor) = registry.listAgents(100, 10);
        assertEq(agents.length, 0);
        assertEq(nextCursor, 0);
    }

    // ───────── agentCount ─────────

    function test_agentCount() public {
        assertEq(registry.agentCount(), 0);

        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);
        assertEq(registry.agentCount(), 1);

        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B);
        assertEq(registry.agentCount(), 2);
    }

    // ───────── Owner pause/unpause ─────────

    function test_globalPause_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.pause();
    }

    function test_globalUnpause_onlyOwner() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.unpause();
    }

    function test_globalPauseAndUnpause_flow() public {
        vm.prank(owner);
        registry.pause();

        // Cannot register while paused
        vm.prank(alice);
        vm.expectRevert();
        registry.registerAgent(ENDPOINT_A);

        vm.prank(owner);
        registry.unpause();

        // Can register after unpause
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);
        assertEq(registry.agentCount(), 1);
    }

    // ───────── Multiple agents end-to-end ─────────

    function test_multipleAgents_fullFlow() public {
        // Register
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A);
        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B);

        // Pause alice
        vm.prank(alice);
        registry.pauseAgent();
        assertFalse(registry.getAgent(alice).active);
        assertTrue(registry.getAgent(bob).active);

        // Update bob
        vm.prank(bob);
        registry.updateProfile("https://new-bob.com");
        assertEq(registry.getAgent(bob).endpoint, "https://new-bob.com");

        // Resume alice
        vm.prank(alice);
        registry.resumeAgent();
        assertTrue(registry.getAgent(alice).active);

        // Count stays the same
        assertEq(registry.agentCount(), 2);
    }
}
