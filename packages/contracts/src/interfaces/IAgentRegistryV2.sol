// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAgentRegistryV2
 * @notice Canonical on-chain registry of Sage agents — V2 with capability +
 *         price + rich-profile fields (per ADR-0008 amendment 2026-06-04,
 *         §M11.2 platform layer).
 *
 *         Deploy: CreateX + CREATE3, salt keccak256("sage:registry:v2")
 *         (ADR-0001). Lives parallel to v1 `AgentRegistry` at
 *         `sage:registry:v1` — v1 stays operational for agents that
 *         registered there; v2 is the platform-aware registry.
 *
 *         Anchor pattern unchanged (ADR-0002): Sage deploys this contract
 *         on Base as the canonical identity layer. Spoke chains
 *         (Arbitrum, OP, BNB) don't get their own registry — the SDK
 *         verifies agent identity against Base.
 */
interface IAgentRegistryV2 {
    // ───────── Structs ─────────

    /// @notice A capability the agent claims, with its flat per-task price.
    /// @dev Names are free-form strings (e.g. "summarize", "translate",
    ///      "vision-describe", "sentiment-classify"). Matching is the
    ///      classifier / plan-editor's responsibility; the registry only
    ///      stores. `price` is USDC base units per task (6 decimals).
    struct Capability {
        string name;
        uint256 price;
    }

    struct Agent {
        /// @notice The agent EOA. Equal to msg.sender at registration time.
        address owner;
        /// @notice Where the agent is reachable. URI scheme defines the
        ///         transport: "http(s)://", "ws://", or "on-chain://<eventTopic>"
        ///         for agents that listen via on-chain TaskCreated polling.
        string endpoint;
        /// @notice Optional IPFS / HTTPS pointer to a richer agent profile
        ///         (description, examples, model card, etc.). Empty string
        ///         means "no off-chain profile".
        string profileUri;
        /// @notice Capabilities + per-task prices. Empty array means the
        ///         agent registered without any priced capabilities — discovery
        ///         via the registry will skip it.
        Capability[] capabilities;
        /// @notice Unix timestamp of registration. Set on first register; not
        ///         changed by updates.
        uint64 registeredAt;
        /// @notice True when the agent is currently accepting work. False
        ///         when paused (by agent itself or by registry owner via
        ///         emergency-pause).
        bool active;
    }

    // ───────── Events ─────────

    event AgentRegistered(
        address indexed agent,
        string endpoint,
        string profileUri,
        uint256 capabilityCount
    );
    event AgentEndpointUpdated(address indexed agent, string endpoint);
    event AgentProfileUriUpdated(address indexed agent, string profileUri);
    event AgentCapabilitiesUpdated(address indexed agent, uint256 capabilityCount);
    event AgentPaused(address indexed agent);
    event AgentResumed(address indexed agent);

    // ───────── Errors ─────────

    error AlreadyRegistered();
    error NotRegistered();
    error AlreadyInState();
    error EmptyEndpoint();

    /// @notice A capability's `name` field was an empty string.
    error EmptyCapabilityName();

    /// @notice A capability's `price` was zero. Discovery treats zero as
    ///         "unpriced", which the registry rejects — explicit pricing is
    ///         required so the plan-editor's cost estimate is non-degenerate.
    error ZeroCapabilityPrice();

    /// @notice The capabilities array had duplicate names. Each capability
    ///         name must appear at most once per agent.
    error DuplicateCapability(string name);

    // ───────── Write functions ─────────

    /// @notice Register a new agent. Reverts if msg.sender already registered.
    /// @param endpoint URI where the agent is reachable. Non-empty.
    /// @param profileUri Optional URI for rich-profile metadata (empty string OK).
    /// @param capabilities Capability list with per-task prices. Empty array allowed
    ///        (agent registers as identity-only; discovery will skip it).
    function registerAgent(
        string calldata endpoint,
        string calldata profileUri,
        Capability[] calldata capabilities
    ) external;

    /// @notice Update only the endpoint URI. Reverts if not registered.
    function updateEndpoint(string calldata endpoint) external;

    /// @notice Update only the profileUri. Empty string clears it.
    function updateProfileUri(string calldata profileUri) external;

    /// @notice Replace the capability list entirely. Pass an empty array to
    ///         remove all capabilities (the agent stays registered for
    ///         identity but is skipped during capability-based discovery).
    function updateCapabilities(Capability[] calldata capabilities) external;

    /// @notice Pause the caller's agent (set inactive). Reverts if already paused.
    function pauseAgent() external;

    /// @notice Resume the caller's agent (set active). Reverts if already active.
    function resumeAgent() external;

    // ───────── View functions ─────────

    function getAgent(address agent) external view returns (Agent memory);

    function listAgents(uint256 cursor, uint256 limit)
        external
        view
        returns (Agent[] memory agents, uint256 nextCursor);

    function agentCount() external view returns (uint256);
}
