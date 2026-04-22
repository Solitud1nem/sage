// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgentRegistry
 * @notice Canonical on-chain registry of Sage agents.
 *         Deployed on Base as the anchor chain (ADR-0002).
 *         Stores minimal on-chain data; rich profile via EAS attestations.
 */
interface IAgentRegistry {
    // ───────── Structs ─────────

    struct Agent {
        address owner;
        string endpoint;
        uint64 registeredAt;
        bool active;
    }

    // ───────── Events ─────────

    event AgentRegistered(address indexed agent, string endpoint);
    event AgentUpdated(address indexed agent, string endpoint);
    event AgentPaused(address indexed agent);
    event AgentResumed(address indexed agent);

    // ───────── Errors ─────────

    /// @notice Caller is already registered.
    error AlreadyRegistered();

    /// @notice Caller is not registered.
    error NotRegistered();

    /// @notice Agent is already in the requested active/paused state.
    error AlreadyInState();

    /// @notice Provided endpoint string is empty.
    error EmptyEndpoint();

    // ───────── Write functions ─────────

    /// @notice Register a new agent with the given endpoint.
    /// @param endpoint HTTP(S) or IPFS URL where the agent is reachable.
    function registerAgent(string calldata endpoint) external;

    /// @notice Update the endpoint of an existing agent.
    /// @param endpoint New endpoint URL.
    function updateProfile(string calldata endpoint) external;

    /// @notice Pause the caller's agent (set inactive). Reverts if already paused.
    function pauseAgent() external;

    /// @notice Resume the caller's agent (set active). Reverts if already active.
    function resumeAgent() external;

    // ───────── View functions ─────────

    /// @notice Get the record for a specific agent.
    /// @param agent Address of the agent to look up.
    /// @return The Agent struct. If not registered, owner will be address(0).
    function getAgent(address agent) external view returns (Agent memory);

    /// @notice List active agents with cursor-based pagination.
    /// @param cursor Starting index in the agent list.
    /// @param limit Maximum number of agents to return.
    /// @return agents Array of Agent structs.
    /// @return nextCursor Next cursor value, or 0 if no more pages.
    function listAgents(uint256 cursor, uint256 limit)
        external
        view
        returns (Agent[] memory agents, uint256 nextCursor);
}
