// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/**
 * @title Verify
 * @notice Helper for post-deploy contract verification on Basescan / Etherscan.
 *
 *         In most cases, `--verify` flag on `forge script Deploy.s.sol` handles
 *         verification automatically. This script is a fallback for manual verification
 *         when auto-verify fails (e.g. CREATE3-deployed contracts).
 *
 * Usage:
 *   # Verify AgentRegistry on Base Sepolia:
 *   forge verify-contract <REGISTRY_ADDRESS> src/AgentRegistry.sol:AgentRegistry \
 *     --constructor-args $(cast abi-encode "constructor(address)" $REGISTRY_OWNER) \
 *     --chain-id 84532 \
 *     --etherscan-api-key $BASESCAN_API_KEY
 *
 *   # Verify TaskEscrow on Base Sepolia:
 *   forge verify-contract <ESCROW_ADDRESS> src/TaskEscrow.sol:TaskEscrow \
 *     --constructor-args $(cast abi-encode "constructor(address)" $USDC_ADDRESS) \
 *     --chain-id 84532 \
 *     --etherscan-api-key $BASESCAN_API_KEY
 *
 *   # Verify on Base mainnet (chain-id 8453):
 *   Same commands with --chain-id 8453
 *
 * Notes:
 *   - CREATE3 deploys use a proxy factory internally, which can confuse
 *     auto-verification. Manual verify-contract is the reliable fallback.
 *   - Ensure the exact same compiler settings (solc 0.8.24, optimizer 200 runs,
 *     EVM Cancun) are used — these are set in foundry.toml.
 *   - BASESCAN_API_KEY env var is required for both Base Sepolia and mainnet.
 */
contract Verify is Script {
    function run() external view {
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address escrowAddr = vm.envAddress("ESCROW_ADDRESS");
        address registryOwner = vm.envAddress("REGISTRY_OWNER");
        address usdcAddress = vm.envAddress("USDC_ADDRESS");

        console2.log("=== Verification Commands ===");
        console2.log("");
        console2.log("AgentRegistry at:", registryAddr);
        console2.log("  Constructor arg (owner):", registryOwner);
        console2.log("  Run:");
        console2.log(
            "  forge verify-contract",
            registryAddr,
            "src/AgentRegistry.sol:AgentRegistry"
        );
        console2.log("    --constructor-args $(cast abi-encode 'constructor(address)'", registryOwner, ")");
        console2.log("    --chain-id", block.chainid);
        console2.log("    --etherscan-api-key $BASESCAN_API_KEY");
        console2.log("");
        console2.log("TaskEscrow at:", escrowAddr);
        console2.log("  Constructor arg (USDC):", usdcAddress);
        console2.log("  Run:");
        console2.log(
            "  forge verify-contract",
            escrowAddr,
            "src/TaskEscrow.sol:TaskEscrow"
        );
        console2.log("    --constructor-args $(cast abi-encode 'constructor(address)'", usdcAddress, ")");
        console2.log("    --chain-id", block.chainid);
        console2.log("    --etherscan-api-key $BASESCAN_API_KEY");
    }
}
