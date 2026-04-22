// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {ICreateX} from "../src/interfaces/ICreateX.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Deploy
 * @notice Deploys AgentRegistry and TaskEscrow via CreateX + CREATE3 for
 *         deterministic addresses across all supported EVM chains (ADR-0001).
 *
 * Usage:
 *   # Dry-run on Anvil fork:
 *   forge script script/Deploy.s.sol --fork-url $BASE_RPC
 *
 *   # Deploy on Base Sepolia:
 *   forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
 *
 *   # Deploy on Base mainnet:
 *   forge script script/Deploy.s.sol --rpc-url $BASE_MAINNET_RPC --broadcast --verify
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of the deployer EOA
 *   USDC_ADDRESS         — USDC token address on the target chain
 *   REGISTRY_OWNER       — owner address for AgentRegistry emergency pause
 */
contract Deploy is Script {
    // CreateX factory — same address on all supported EVM chains
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address registryOwner = vm.envAddress("REGISTRY_OWNER");

        console2.log("Deployer:", deployer);
        console2.log("USDC:", usdcAddress);
        console2.log("Registry owner:", registryOwner);
        console2.log("Chain ID:", block.chainid);

        // Construct guarded salts: deployer-restricted, chain-agnostic
        // Layout: bytes[0:20] = deployer, byte[20] = 0x00 (cross-chain), bytes[21:32] = entropy
        bytes32 registrySalt = _buildSalt(deployer, keccak256("sage:registry:v1"));
        bytes32 escrowSalt = _buildSalt(deployer, keccak256("sage:escrow:v1"));

        console2.log("Registry salt:", vm.toString(registrySalt));
        console2.log("Escrow salt:", vm.toString(escrowSalt));

        vm.startBroadcast(deployerKey);

        // Deploy AgentRegistry
        bytes memory registryInitCode = abi.encodePacked(
            type(AgentRegistry).creationCode,
            abi.encode(registryOwner)
        );
        address registry = CREATEX.deployCreate3(registrySalt, registryInitCode);
        console2.log("AgentRegistry deployed at:", registry);

        // Deploy TaskEscrow
        bytes memory escrowInitCode = abi.encodePacked(
            type(TaskEscrow).creationCode,
            abi.encode(IERC20(usdcAddress))
        );
        address escrowAddr = CREATEX.deployCreate3(escrowSalt, escrowInitCode);
        console2.log("TaskEscrow deployed at:", escrowAddr);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("Chain ID:       ", block.chainid);
        console2.log("AgentRegistry:  ", registry);
        console2.log("TaskEscrow:     ", escrowAddr);
        console2.log("USDC:           ", usdcAddress);
        console2.log("Registry Owner: ", registryOwner);
    }

    /// @dev Build a CreateX guarded salt: deployer-bound, chain-agnostic.
    ///      bytes[0:20] = deployer address
    ///      byte[20]    = 0x00 (chain-agnostic)
    ///      bytes[21:32] = first 11 bytes of entropyHash
    function _buildSalt(address deployer, bytes32 entropyHash) internal pure returns (bytes32) {
        return bytes32(
            (uint256(uint160(deployer)) << 96) | // bytes [0:20] = deployer
            // byte [20] = 0x00 (chain-agnostic, implicitly zero)
            (uint256(uint88(bytes11(entropyHash))) ) // bytes [21:32] = entropy
        );
    }
}
