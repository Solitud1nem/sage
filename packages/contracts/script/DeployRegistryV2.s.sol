// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistryV2} from "../src/AgentRegistryV2.sol";
import {ICreateX} from "../src/interfaces/ICreateX.sol";

/**
 * @title DeployRegistryV2
 * @notice Deploys AgentRegistryV2 via CreateX + CREATE3 with the registry v2
 *         salt (ADR-0001) for M11.2. AgentRegistry v1 stays canonical for
 *         legacy agents; v2 is the platform-aware registry with capability +
 *         price + rich-profile fields.
 *
 * Usage:
 *   # Dry-run on a fork:
 *   forge script script/DeployRegistryV2.s.sol --fork-url $BASE_SEPOLIA_RPC
 *
 *   # Deploy on Base Sepolia:
 *   forge script script/DeployRegistryV2.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
 *
 *   # Deploy on Base mainnet (after Sepolia smoke green):
 *   forge script script/DeployRegistryV2.s.sol --rpc-url $BASE_MAINNET_RPC --broadcast --verify
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of the deployer EOA
 *   REGISTRY_OWNER       — owner EOA for emergency pause
 *                          (same EOA as TaskEscrowV2 owner per M11.2 launch posture)
 *
 * Notes:
 *   - Salt: keccak256("sage:registry:v2"). Same deployer + same salt yields
 *     the same address on Base mainnet + Base Sepolia, per ADR-0001 invariant.
 *   - V1 registry stays at sage:registry:v1 address; both work in parallel.
 *   - No constructor token args, so the v2 address is fully bytecode-driven
 *     (no chain-specific immutables) — actually identical bytecode across
 *     mainnet + Sepolia, salt-determined address.
 */
contract DeployRegistryV2 is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address registryOwner = vm.envAddress("REGISTRY_OWNER");

        console2.log("Deployer:        ", deployer);
        console2.log("Registry owner:  ", registryOwner);
        console2.log("Chain ID:        ", block.chainid);

        bytes32 salt = _buildSalt(deployer, keccak256("sage:registry:v2"));
        console2.log("Registry salt:   ", vm.toString(salt));

        vm.startBroadcast(deployerKey);

        bytes memory initCode = abi.encodePacked(
            type(AgentRegistryV2).creationCode,
            abi.encode(registryOwner)
        );
        address registryAddr = CREATEX.deployCreate3(salt, initCode);

        vm.stopBroadcast();

        // Post-deploy sanity reads.
        AgentRegistryV2 registry = AgentRegistryV2(registryAddr);
        require(registry.owner() == registryOwner, "DeployRegistryV2: owner mismatch");
        require(!registry.paused(), "DeployRegistryV2: should start unpaused");
        require(registry.agentCount() == 0, "DeployRegistryV2: should start empty");

        console2.log("");
        console2.log("=== AgentRegistryV2 Deployment Summary ===");
        console2.log("Chain ID:        ", block.chainid);
        console2.log("AgentRegistryV2: ", registryAddr);
        console2.log("Owner:           ", registryOwner);
        console2.log("");
        console2.log("v1 AgentRegistry at sage:registry:v1 remains canonical for legacy agents.");
        console2.log("Register demo-agents in v2 via the registration script (M11.2.11).");
    }

    /// @dev See DeployV2.s.sol for the salt layout rationale. Identical helper.
    function _buildSalt(address deployer, bytes32 entropyHash) internal pure returns (bytes32) {
        return bytes32(
            (uint256(uint160(deployer)) << 96) |
            (uint256(uint88(bytes11(entropyHash))) )
        );
    }
}
