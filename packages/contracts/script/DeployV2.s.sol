// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TaskEscrowV2} from "../src/TaskEscrowV2.sol";
import {ICreateX} from "../src/interfaces/ICreateX.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployV2
 * @notice Deploys TaskEscrowV2 via CreateX + CREATE3 with the v2 salt per
 *         ADR-0001 + ADR-0017. AgentRegistry is NOT touched — v1 registry
 *         on Base mainnet continues to serve until M11.2 schema extension.
 *
 * Usage:
 *   # Dry-run on a fork:
 *   forge script script/DeployV2.s.sol --fork-url $BASE_SEPOLIA_RPC
 *
 *   # Deploy on Base Sepolia:
 *   forge script script/DeployV2.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify
 *
 *   # Deploy on Base mainnet (only after Sepolia smoke green):
 *   forge script script/DeployV2.s.sol --rpc-url $BASE_MAINNET_RPC --broadcast --verify
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of the deployer EOA
 *   USDC_ADDRESS         — USDC token address on the target chain
 *   INITIAL_OWNER        — owner EOA on launch (holds setArbiter authority)
 *   INITIAL_ARBITER      — arbiter EOA on launch (calls resolveDispute)
 *
 * Notes on launch posture (per session 2026-06-08):
 *   - All three roles (deployer, owner, arbiter) collapse to one EOA on launch.
 *     This is operational simplicity for v3.0 bring-up; intended migration is
 *     transferOwnership to a Safe / multisig and a separate arbiter key once
 *     the council mechanism (M11.4) needs them isolated.
 *   - The contract enforces arbiter ≠ 0x0; passing 0x0 reverts ZeroArbiter.
 *
 * v2.0 contracts at sage:escrow:v1 continue serving in-flight tasks on
 * Base mainnet (0x12aeF3...3E1e); v3.0 deploys to a new deterministic
 * address derived from the :v2 salt.
 */
contract DeployV2 is Script {
    // CreateX factory — same address on all supported EVM chains (ADR-0001).
    // Not deployed on Arc testnet — Arc deploy uses a separate script with
    // Arachnid CREATE2 per ADR-0015.
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address initialOwner = vm.envAddress("INITIAL_OWNER");
        address initialArbiter = vm.envAddress("INITIAL_ARBITER");

        console2.log("Deployer:        ", deployer);
        console2.log("USDC:            ", usdcAddress);
        console2.log("Initial owner:   ", initialOwner);
        console2.log("Initial arbiter: ", initialArbiter);
        console2.log("Chain ID:        ", block.chainid);

        bytes32 escrowSalt = _buildSalt(deployer, keccak256("sage:escrow:v2"));
        console2.log("Escrow salt:     ", vm.toString(escrowSalt));

        vm.startBroadcast(deployerKey);

        bytes memory escrowInitCode = abi.encodePacked(
            type(TaskEscrowV2).creationCode,
            abi.encode(IERC20(usdcAddress), initialOwner, initialArbiter)
        );
        address escrowAddr = CREATEX.deployCreate3(escrowSalt, escrowInitCode);

        vm.stopBroadcast();

        // Post-deploy sanity reads. Cheap, catches the obvious miswiring early.
        TaskEscrowV2 escrow = TaskEscrowV2(escrowAddr);
        require(address(escrow.USDC()) == usdcAddress, "DeployV2: USDC mismatch");
        require(escrow.owner() == initialOwner, "DeployV2: owner mismatch");
        require(escrow.arbiter() == initialArbiter, "DeployV2: arbiter mismatch");

        console2.log("");
        console2.log("=== TaskEscrowV2 Deployment Summary ===");
        console2.log("Chain ID:        ", block.chainid);
        console2.log("TaskEscrowV2:    ", escrowAddr);
        console2.log("USDC:            ", usdcAddress);
        console2.log("Owner:           ", initialOwner);
        console2.log("Arbiter:         ", initialArbiter);
        console2.log("");
        console2.log("v2.0 TaskEscrow at sage:escrow:v1 remains canonical for in-flight v2 tasks.");
        console2.log("Update SDK / orchestrator config to point new tasks at the address above.");
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
