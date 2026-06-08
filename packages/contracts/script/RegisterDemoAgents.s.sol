// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistryV2} from "../src/AgentRegistryV2.sol";
import {IAgentRegistryV2} from "../src/interfaces/IAgentRegistryV2.sol";

/**
 * @title RegisterDemoAgents
 * @notice One-time registration of Sage's 4 demo worker agents in
 *         AgentRegistryV2 (M11.2). Each worker signs its own registerAgent
 *         transaction using its own private key from env.
 *
 *         Capability names match the stems the classifier already uses
 *         (apps/web/hooks/use-composite-demo.ts `resolveExecutorByType`),
 *         so plan-runner discovery via the registry will match the same
 *         executor it would have picked via stem-matching.
 *
 *         Prices are uniform at 1000 USDC base units (= 0.001 USDC) — same
 *         as the demo's default TASK_AMOUNT. Reasonable starting point for
 *         the substrate; real foreign agents will price differently per
 *         their cost structure.
 *
 *         endpoint is "on-chain://task-events" — a convention indicating
 *         the agent listens by polling TaskCreated events (not HTTP push).
 *         profileUri is empty for now — demo-agents don't have a public
 *         profile page yet.
 *
 * Usage:
 *   forge script script/RegisterDemoAgents.s.sol \
 *     --rpc-url $BASE_MAINNET_RPC --broadcast -vvvv
 *
 * Environment variables (all required):
 *   REGISTRY_V2_ADDRESS         — AgentRegistryV2 deployed address
 *   SUMMARIZER_PRIVATE_KEY      — summarizer EOA key
 *   TRANSLATOR_PRIVATE_KEY      — translator EOA key
 *   SENTIMENT_PRIVATE_KEY       — sentiment EOA key
 *   VISION_PRIVATE_KEY          — vision EOA key
 *
 * Note: workers need enough ETH on the target chain to pay gas. Per-worker
 * gas estimate: ~250k for registerAgent with 1 capability. At 0.006 gwei
 * that's ~0.0000015 ETH each, ~0.000006 ETH total across 4 workers.
 */
contract RegisterDemoAgents is Script {
    string constant ENDPOINT = "on-chain://task-events";
    string constant PROFILE_URI = "";
    uint256 constant PRICE = 1000; // 0.001 USDC

    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_V2_ADDRESS");
        AgentRegistryV2 registry = AgentRegistryV2(registryAddr);

        console2.log("Registry V2:     ", registryAddr);
        console2.log("Chain ID:        ", block.chainid);
        console2.log("");

        _registerAgent(
            registry,
            vm.envUint("SUMMARIZER_PRIVATE_KEY"),
            "Summarizer",
            "summarize"
        );

        _registerAgent(
            registry,
            vm.envUint("TRANSLATOR_PRIVATE_KEY"),
            "Translator",
            "translate"
        );

        _registerAgent(
            registry,
            vm.envUint("SENTIMENT_PRIVATE_KEY"),
            "Sentiment",
            "sentiment-classify"
        );

        _registerAgent(
            registry,
            vm.envUint("VISION_PRIVATE_KEY"),
            "Vision",
            "vision-describe"
        );

        console2.log("");
        console2.log("=== Registration Summary ===");
        console2.log("Total agents in registry:", registry.agentCount());
    }

    function _registerAgent(
        AgentRegistryV2 registry,
        uint256 privateKey,
        string memory name,
        string memory capabilityName
    ) internal {
        address agent = vm.addr(privateKey);

        // Idempotency: if already registered (re-run), skip.
        IAgentRegistryV2.Agent memory existing = registry.getAgent(agent);
        if (existing.owner != address(0)) {
            console2.log(name, "already registered, skipping:", agent);
            return;
        }

        IAgentRegistryV2.Capability[] memory caps = new IAgentRegistryV2.Capability[](1);
        caps[0] = IAgentRegistryV2.Capability({name: capabilityName, price: PRICE});

        vm.startBroadcast(privateKey);
        registry.registerAgent(ENDPOINT, PROFILE_URI, caps);
        vm.stopBroadcast();

        console2.log(name, "registered:", agent);
        console2.log("  capability:    ", capabilityName);
        console2.log("  price (units): ", PRICE);
    }
}
