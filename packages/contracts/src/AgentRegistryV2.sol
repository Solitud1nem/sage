// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAgentRegistryV2} from "./interfaces/IAgentRegistryV2.sol";

/**
 * @title AgentRegistryV2
 * @notice Canonical Sage agent registry — V2 (capability + price + rich profile).
 *         Deploy: CreateX + CREATE3, salt keccak256("sage:registry:v2") (ADR-0001).
 *         Lives parallel to v1; v1 stays operational for legacy agents.
 *
 *         Owner-pause is preserved from v1 — emergency stop for new
 *         registrations and write updates. Anchor pattern (ADR-0002):
 *         Base canonical; spoke chains use this same address (when v2 ships
 *         elsewhere) for identity verification.
 */
contract AgentRegistryV2 is IAgentRegistryV2, Ownable, Pausable {
    // ───────── Storage ─────────

    /// @notice Agent record by address.
    mapping(address => Agent) private _agents;

    /// @notice Ordered list of all registered agent addresses (for pagination).
    address[] private _agentList;

    /// @notice Index+1 of each agent in _agentList (0 = not in list).
    mapping(address => uint256) private _agentIndex;

    // ───────── Constructor ─────────

    /// @param owner_ Address with emergency pause capability. Use multisig or
    ///        address(0) is rejected by Ownable. Sage's M11.2 launch posture
    ///        uses the same EOA as for TaskEscrowV2 ownership.
    constructor(address owner_) Ownable(owner_) {}

    // ───────── Write functions ─────────

    /// @inheritdoc IAgentRegistryV2
    function registerAgent(
        string calldata endpoint,
        string calldata profileUri,
        Capability[] calldata capabilities
    ) external whenNotPaused {
        if (_agents[msg.sender].owner != address(0)) revert AlreadyRegistered();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();
        _validateCapabilities(capabilities);

        Agent storage agent = _agents[msg.sender];
        agent.owner = msg.sender;
        agent.endpoint = endpoint;
        agent.profileUri = profileUri;
        agent.registeredAt = uint64(block.timestamp);
        agent.active = true;

        // Copy capabilities into storage. Solidity does NOT support direct
        // assignment of `calldata Capability[]` to a `storage Capability[]`
        // when the inner struct contains dynamic fields (string `name`), so
        // we push one-by-one.
        for (uint256 i = 0; i < capabilities.length; i++) {
            agent.capabilities.push(capabilities[i]);
        }

        _agentList.push(msg.sender);
        _agentIndex[msg.sender] = _agentList.length; // 1-based

        emit AgentRegistered(msg.sender, endpoint, profileUri, capabilities.length);
    }

    /// @inheritdoc IAgentRegistryV2
    function updateEndpoint(string calldata endpoint) external whenNotPaused {
        if (_agents[msg.sender].owner == address(0)) revert NotRegistered();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();

        _agents[msg.sender].endpoint = endpoint;

        emit AgentEndpointUpdated(msg.sender, endpoint);
    }

    /// @inheritdoc IAgentRegistryV2
    function updateProfileUri(string calldata profileUri) external whenNotPaused {
        if (_agents[msg.sender].owner == address(0)) revert NotRegistered();

        _agents[msg.sender].profileUri = profileUri;

        emit AgentProfileUriUpdated(msg.sender, profileUri);
    }

    /// @inheritdoc IAgentRegistryV2
    function updateCapabilities(Capability[] calldata capabilities) external whenNotPaused {
        if (_agents[msg.sender].owner == address(0)) revert NotRegistered();
        _validateCapabilities(capabilities);

        Agent storage agent = _agents[msg.sender];

        // Clear existing capabilities array, then refill. `delete` resets
        // length to 0 and zeroes element slots — Solidity-standard pattern.
        delete agent.capabilities;
        for (uint256 i = 0; i < capabilities.length; i++) {
            agent.capabilities.push(capabilities[i]);
        }

        emit AgentCapabilitiesUpdated(msg.sender, capabilities.length);
    }

    /// @inheritdoc IAgentRegistryV2
    function pauseAgent() external {
        Agent storage agent = _agents[msg.sender];
        if (agent.owner == address(0)) revert NotRegistered();
        if (!agent.active) revert AlreadyInState();

        agent.active = false;

        emit AgentPaused(msg.sender);
    }

    /// @inheritdoc IAgentRegistryV2
    function resumeAgent() external whenNotPaused {
        Agent storage agent = _agents[msg.sender];
        if (agent.owner == address(0)) revert NotRegistered();
        if (agent.active) revert AlreadyInState();

        agent.active = true;

        emit AgentResumed(msg.sender);
    }

    // ───────── View functions ─────────

    /// @inheritdoc IAgentRegistryV2
    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    /// @inheritdoc IAgentRegistryV2
    function listAgents(uint256 cursor, uint256 limit)
        external
        view
        returns (Agent[] memory agents, uint256 nextCursor)
    {
        uint256 total = _agentList.length;

        if (cursor >= total) {
            return (new Agent[](0), 0);
        }

        uint256 remaining = total - cursor;
        uint256 count = remaining < limit ? remaining : limit;

        agents = new Agent[](count);
        for (uint256 i = 0; i < count; i++) {
            agents[i] = _agents[_agentList[cursor + i]];
        }

        nextCursor = cursor + count < total ? cursor + count : 0;
    }

    /// @inheritdoc IAgentRegistryV2
    function agentCount() external view returns (uint256) {
        return _agentList.length;
    }

    // ───────── Owner-only emergency functions ─────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────── Internal helpers ─────────

    function _validateCapabilities(Capability[] calldata capabilities) internal pure {
        // O(n²) duplicate check is acceptable — capabilities per agent are
        // expected to be small (typically 1-5), and registration is rare
        // relative to read traffic. Off-chain agents validate before submit.
        for (uint256 i = 0; i < capabilities.length; i++) {
            if (bytes(capabilities[i].name).length == 0) revert EmptyCapabilityName();
            if (capabilities[i].price == 0) revert ZeroCapabilityPrice();
            for (uint256 j = i + 1; j < capabilities.length; j++) {
                if (
                    keccak256(bytes(capabilities[i].name))
                    == keccak256(bytes(capabilities[j].name))
                ) {
                    revert DuplicateCapability(capabilities[i].name);
                }
            }
        }
    }
}
