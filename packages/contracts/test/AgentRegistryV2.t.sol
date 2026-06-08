// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistryV2} from "../src/AgentRegistryV2.sol";
import {IAgentRegistryV2} from "../src/interfaces/IAgentRegistryV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract AgentRegistryV2Test is Test {
    AgentRegistryV2 public registry;

    address public owner = makeAddr("owner");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    string constant ENDPOINT_A = "https://alice-agent.com";
    string constant ENDPOINT_B = "https://bob-agent.com";
    string constant ENDPOINT_C = "https://carol-agent.com";
    string constant ENDPOINT_UPDATED = "https://alice-agent-v2.com";

    string constant PROFILE_A = "ipfs://QmAlice";
    string constant PROFILE_UPDATED = "ipfs://QmAliceV2";

    function setUp() public {
        registry = new AgentRegistryV2(owner);
    }

    // ───────── Helpers ─────────

    function _cap(string memory name, uint256 price)
        internal
        pure
        returns (IAgentRegistryV2.Capability memory)
    {
        return IAgentRegistryV2.Capability({name: name, price: price});
    }

    function _caps2(string memory n1, uint256 p1, string memory n2, uint256 p2)
        internal
        pure
        returns (IAgentRegistryV2.Capability[] memory caps)
    {
        caps = new IAgentRegistryV2.Capability[](2);
        caps[0] = _cap(n1, p1);
        caps[1] = _cap(n2, p2);
    }

    function _emptyCaps() internal pure returns (IAgentRegistryV2.Capability[] memory) {
        return new IAgentRegistryV2.Capability[](0);
    }

    function _registerAlice() internal {
        IAgentRegistryV2.Capability[] memory caps = _caps2("summarize", 100_000, "translate", 200_000);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, caps);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Constructor + Ownable
    // ═══════════════════════════════════════════════════════════════════

    function test_constructor_setsOwner() public view {
        assertEq(registry.owner(), owner);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AgentRegistryV2(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════
    // registerAgent — happy + validation
    // ═══════════════════════════════════════════════════════════════════

    function test_registerAgent_happyPath_withCapabilities() public {
        IAgentRegistryV2.Capability[] memory caps = _caps2("summarize", 100_000, "translate", 200_000);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit IAgentRegistryV2.AgentRegistered(alice, ENDPOINT_A, PROFILE_A, 2);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, caps);

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.owner, alice);
        assertEq(a.endpoint, ENDPOINT_A);
        assertEq(a.profileUri, PROFILE_A);
        assertEq(a.capabilities.length, 2);
        assertEq(a.capabilities[0].name, "summarize");
        assertEq(a.capabilities[0].price, 100_000);
        assertEq(a.capabilities[1].name, "translate");
        assertEq(a.capabilities[1].price, 200_000);
        assertEq(a.registeredAt, block.timestamp);
        assertTrue(a.active);
        assertEq(registry.agentCount(), 1);
    }

    function test_registerAgent_emptyProfileUri_OK() public {
        IAgentRegistryV2.Capability[] memory caps = _caps2("summarize", 100_000, "translate", 200_000);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, "", caps);

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.profileUri, "");
    }

    function test_registerAgent_emptyCapabilities_OK() public {
        // Identity-only registration. Agent is registered but discovery skips it.
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, _emptyCaps());

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.owner, alice);
        assertEq(a.capabilities.length, 0);
        assertTrue(a.active);
    }

    function test_registerAgent_reverts_AlreadyRegistered() public {
        _registerAlice();

        vm.expectRevert(IAgentRegistryV2.AlreadyRegistered.selector);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, _emptyCaps());
    }

    function test_registerAgent_reverts_EmptyEndpoint() public {
        vm.expectRevert(IAgentRegistryV2.EmptyEndpoint.selector);
        vm.prank(alice);
        registry.registerAgent("", PROFILE_A, _emptyCaps());
    }

    function test_registerAgent_reverts_EmptyCapabilityName() public {
        IAgentRegistryV2.Capability[] memory caps = new IAgentRegistryV2.Capability[](1);
        caps[0] = _cap("", 100_000);

        vm.expectRevert(IAgentRegistryV2.EmptyCapabilityName.selector);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, caps);
    }

    function test_registerAgent_reverts_ZeroCapabilityPrice() public {
        IAgentRegistryV2.Capability[] memory caps = new IAgentRegistryV2.Capability[](1);
        caps[0] = _cap("summarize", 0);

        vm.expectRevert(IAgentRegistryV2.ZeroCapabilityPrice.selector);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, caps);
    }

    function test_registerAgent_reverts_DuplicateCapability() public {
        IAgentRegistryV2.Capability[] memory caps = _caps2("summarize", 100_000, "summarize", 200_000);

        vm.expectRevert(
            abi.encodeWithSelector(IAgentRegistryV2.DuplicateCapability.selector, "summarize")
        );
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, caps);
    }

    function test_registerAgent_reverts_WhenPaused() public {
        vm.prank(owner);
        registry.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, PROFILE_A, _emptyCaps());
    }

    // ═══════════════════════════════════════════════════════════════════
    // updateEndpoint
    // ═══════════════════════════════════════════════════════════════════

    function test_updateEndpoint_happyPath() public {
        _registerAlice();

        vm.expectEmit(true, false, false, true);
        emit IAgentRegistryV2.AgentEndpointUpdated(alice, ENDPOINT_UPDATED);

        vm.prank(alice);
        registry.updateEndpoint(ENDPOINT_UPDATED);

        assertEq(registry.getAgent(alice).endpoint, ENDPOINT_UPDATED);
    }

    function test_updateEndpoint_reverts_NotRegistered() public {
        vm.expectRevert(IAgentRegistryV2.NotRegistered.selector);
        vm.prank(alice);
        registry.updateEndpoint(ENDPOINT_UPDATED);
    }

    function test_updateEndpoint_reverts_Empty() public {
        _registerAlice();
        vm.expectRevert(IAgentRegistryV2.EmptyEndpoint.selector);
        vm.prank(alice);
        registry.updateEndpoint("");
    }

    function test_updateEndpoint_doesNotChange_OtherFields() public {
        _registerAlice();
        uint64 ts = registry.getAgent(alice).registeredAt;

        vm.prank(alice);
        registry.updateEndpoint(ENDPOINT_UPDATED);

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.endpoint, ENDPOINT_UPDATED);
        assertEq(a.profileUri, PROFILE_A); // unchanged
        assertEq(a.capabilities.length, 2); // unchanged
        assertEq(a.registeredAt, ts); // unchanged
    }

    // ═══════════════════════════════════════════════════════════════════
    // updateProfileUri
    // ═══════════════════════════════════════════════════════════════════

    function test_updateProfileUri_happyPath() public {
        _registerAlice();

        vm.expectEmit(true, false, false, true);
        emit IAgentRegistryV2.AgentProfileUriUpdated(alice, PROFILE_UPDATED);

        vm.prank(alice);
        registry.updateProfileUri(PROFILE_UPDATED);

        assertEq(registry.getAgent(alice).profileUri, PROFILE_UPDATED);
    }

    function test_updateProfileUri_emptyClears() public {
        _registerAlice();
        vm.prank(alice);
        registry.updateProfileUri("");

        assertEq(registry.getAgent(alice).profileUri, "");
    }

    function test_updateProfileUri_reverts_NotRegistered() public {
        vm.expectRevert(IAgentRegistryV2.NotRegistered.selector);
        vm.prank(alice);
        registry.updateProfileUri(PROFILE_UPDATED);
    }

    // ═══════════════════════════════════════════════════════════════════
    // updateCapabilities
    // ═══════════════════════════════════════════════════════════════════

    function test_updateCapabilities_replaces() public {
        _registerAlice(); // 2 caps initially

        IAgentRegistryV2.Capability[] memory next = new IAgentRegistryV2.Capability[](1);
        next[0] = _cap("vision-describe", 500_000);

        vm.expectEmit(true, false, false, true);
        emit IAgentRegistryV2.AgentCapabilitiesUpdated(alice, 1);

        vm.prank(alice);
        registry.updateCapabilities(next);

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.capabilities.length, 1);
        assertEq(a.capabilities[0].name, "vision-describe");
        assertEq(a.capabilities[0].price, 500_000);
    }

    function test_updateCapabilities_emptyClearsAll() public {
        _registerAlice();
        vm.prank(alice);
        registry.updateCapabilities(_emptyCaps());

        assertEq(registry.getAgent(alice).capabilities.length, 0);
    }

    function test_updateCapabilities_reverts_NotRegistered() public {
        vm.expectRevert(IAgentRegistryV2.NotRegistered.selector);
        vm.prank(alice);
        registry.updateCapabilities(_emptyCaps());
    }

    function test_updateCapabilities_reverts_DuplicateName() public {
        _registerAlice();
        IAgentRegistryV2.Capability[] memory dup = _caps2("x", 100, "x", 200);

        vm.expectRevert(abi.encodeWithSelector(IAgentRegistryV2.DuplicateCapability.selector, "x"));
        vm.prank(alice);
        registry.updateCapabilities(dup);
    }

    function test_updateCapabilities_reverts_ZeroPrice() public {
        _registerAlice();
        IAgentRegistryV2.Capability[] memory bad = new IAgentRegistryV2.Capability[](1);
        bad[0] = _cap("summarize", 0);

        vm.expectRevert(IAgentRegistryV2.ZeroCapabilityPrice.selector);
        vm.prank(alice);
        registry.updateCapabilities(bad);
    }

    // ═══════════════════════════════════════════════════════════════════
    // pauseAgent / resumeAgent
    // ═══════════════════════════════════════════════════════════════════

    function test_pauseAgent_happyPath() public {
        _registerAlice();

        vm.expectEmit(true, false, false, false);
        emit IAgentRegistryV2.AgentPaused(alice);

        vm.prank(alice);
        registry.pauseAgent();

        assertFalse(registry.getAgent(alice).active);
    }

    function test_pauseAgent_reverts_NotRegistered() public {
        vm.expectRevert(IAgentRegistryV2.NotRegistered.selector);
        vm.prank(alice);
        registry.pauseAgent();
    }

    function test_pauseAgent_reverts_AlreadyPaused() public {
        _registerAlice();
        vm.prank(alice);
        registry.pauseAgent();

        vm.expectRevert(IAgentRegistryV2.AlreadyInState.selector);
        vm.prank(alice);
        registry.pauseAgent();
    }

    function test_resumeAgent_happyPath() public {
        _registerAlice();
        vm.prank(alice);
        registry.pauseAgent();

        vm.expectEmit(true, false, false, false);
        emit IAgentRegistryV2.AgentResumed(alice);

        vm.prank(alice);
        registry.resumeAgent();

        assertTrue(registry.getAgent(alice).active);
    }

    function test_resumeAgent_reverts_AlreadyActive() public {
        _registerAlice();
        vm.expectRevert(IAgentRegistryV2.AlreadyInState.selector);
        vm.prank(alice);
        registry.resumeAgent();
    }

    function test_pauseAgent_worksEvenWhenContractPaused() public {
        // Self-pause should not depend on contract pause state — owners can
        // always stop their own agent.
        _registerAlice();
        vm.prank(owner);
        registry.pause();

        vm.prank(alice);
        registry.pauseAgent(); // succeeds
        assertFalse(registry.getAgent(alice).active);
    }

    function test_resumeAgent_blockedWhenContractPaused() public {
        _registerAlice();
        vm.prank(alice);
        registry.pauseAgent();

        vm.prank(owner);
        registry.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        registry.resumeAgent();
    }

    // ═══════════════════════════════════════════════════════════════════
    // listAgents pagination
    // ═══════════════════════════════════════════════════════════════════

    function test_listAgents_pagination() public {
        _registerAlice();

        IAgentRegistryV2.Capability[] memory bobCaps = _caps2("classify", 50_000, "vision", 300_000);
        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B, "", bobCaps);

        vm.prank(carol);
        registry.registerAgent(ENDPOINT_C, "", _emptyCaps());

        (IAgentRegistryV2.Agent[] memory page1, uint256 next1) = registry.listAgents(0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].owner, alice);
        assertEq(page1[1].owner, bob);
        assertEq(next1, 2);

        (IAgentRegistryV2.Agent[] memory page2, uint256 next2) = registry.listAgents(next1, 2);
        assertEq(page2.length, 1);
        assertEq(page2[0].owner, carol);
        assertEq(next2, 0);
    }

    function test_listAgents_cursorBeyondTotal() public {
        _registerAlice();
        (IAgentRegistryV2.Agent[] memory empty, uint256 next) = registry.listAgents(99, 10);
        assertEq(empty.length, 0);
        assertEq(next, 0);
    }

    function test_agentCount_tracksRegistrations() public {
        assertEq(registry.agentCount(), 0);
        _registerAlice();
        assertEq(registry.agentCount(), 1);
        vm.prank(bob);
        registry.registerAgent(ENDPOINT_B, "", _emptyCaps());
        assertEq(registry.agentCount(), 2);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Owner emergency pause
    // ═══════════════════════════════════════════════════════════════════

    function test_pause_byOwner() public {
        vm.prank(owner);
        registry.pause();
        assertTrue(registry.paused());
    }

    function test_pause_byNonOwner_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        registry.pause();
    }

    function test_unpause_byOwner() public {
        vm.prank(owner);
        registry.pause();
        vm.prank(owner);
        registry.unpause();
        assertFalse(registry.paused());
    }

    // ═══════════════════════════════════════════════════════════════════
    // Edge case — large capability count fuzz
    // ═══════════════════════════════════════════════════════════════════

    function testFuzz_registerAgent_manyCapabilities(uint8 n) public {
        n = uint8(bound(n, 1, 20)); // sane upper bound
        IAgentRegistryV2.Capability[] memory caps = new IAgentRegistryV2.Capability[](n);
        for (uint8 i = 0; i < n; i++) {
            caps[i] = _cap(
                string(abi.encodePacked("cap-", vm.toString(i))),
                uint256(i + 1) * 1000
            );
        }

        vm.prank(alice);
        registry.registerAgent(ENDPOINT_A, "", caps);

        IAgentRegistryV2.Agent memory a = registry.getAgent(alice);
        assertEq(a.capabilities.length, n);
        for (uint8 i = 0; i < n; i++) {
            assertEq(a.capabilities[i].price, uint256(i + 1) * 1000);
        }
    }
}
