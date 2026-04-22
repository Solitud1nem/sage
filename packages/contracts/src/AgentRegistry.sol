// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/**
 * @title AgentRegistry
 * @notice Canonical on-chain registry of Sage agents on Base (anchor chain).
 *         Stores minimal on-chain data per agent; rich profile data lives
 *         off-chain via EAS attestations (ADR-0002).
 *
 *         Deployed via CreateX + CREATE3 with salt keccak256("sage:registry:v1") (ADR-0001).
 *         On spoke chains (Arbitrum, OP, BNB) this contract is NOT deployed —
 *         only TaskEscrow is (ADR-0002).
 */
contract AgentRegistry is IAgentRegistry, Ownable, Pausable {
    // ───────── Storage ─────────

    /// @notice Agent record by address.
    mapping(address => Agent) private _agents;

    /// @notice Ordered list of all registered agent addresses (for pagination).
    address[] private _agentList;

    /// @notice Index+1 of each agent in _agentList (0 = not in list).
    mapping(address => uint256) private _agentIndex;

    // ───────── Constructor ─────────

    /// @param owner_ Address with emergency pause capability. Use multisig or address(0) to disable.
    constructor(address owner_) Ownable(owner_) {}

    // ───────── Write functions ─────────

    /// @inheritdoc IAgentRegistry
    function registerAgent(string calldata endpoint) external whenNotPaused {
        if (_agents[msg.sender].owner != address(0)) revert AlreadyRegistered();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();

        _agents[msg.sender] = Agent({
            owner: msg.sender,
            endpoint: endpoint,
            registeredAt: uint64(block.timestamp),
            active: true
        });

        _agentList.push(msg.sender);
        _agentIndex[msg.sender] = _agentList.length; // 1-based

        emit AgentRegistered(msg.sender, endpoint);
    }

    /// @inheritdoc IAgentRegistry
    function updateProfile(string calldata endpoint) external whenNotPaused {
        if (_agents[msg.sender].owner == address(0)) revert NotRegistered();
        if (bytes(endpoint).length == 0) revert EmptyEndpoint();

        _agents[msg.sender].endpoint = endpoint;

        emit AgentUpdated(msg.sender, endpoint);
    }

    /// @inheritdoc IAgentRegistry
    function pauseAgent() external {
        Agent storage agent = _agents[msg.sender];
        if (agent.owner == address(0)) revert NotRegistered();
        if (!agent.active) revert AlreadyInState();

        agent.active = false;

        emit AgentPaused(msg.sender);
    }

    /// @inheritdoc IAgentRegistry
    function resumeAgent() external whenNotPaused {
        Agent storage agent = _agents[msg.sender];
        if (agent.owner == address(0)) revert NotRegistered();
        if (agent.active) revert AlreadyInState();

        agent.active = true;

        emit AgentResumed(msg.sender);
    }

    // ───────── View functions ─────────

    /// @inheritdoc IAgentRegistry
    function getAgent(address agent) external view returns (Agent memory) {
        return _agents[agent];
    }

    /// @inheritdoc IAgentRegistry
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

    /// @notice Total number of registered agents (including paused).
    function agentCount() external view returns (uint256) {
        return _agentList.length;
    }

    // ───────── Owner-only emergency functions ─────────

    /// @notice Emergency pause — blocks new registrations and profile updates.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause after emergency.
    function unpause() external onlyOwner {
        _unpause();
    }
}
