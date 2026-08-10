// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TaskEscrowV2} from "../src/TaskEscrowV2.sol";
import {ICreateX} from "../src/interfaces/ICreateX.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployEscrowWmon
 * @notice Deploys TaskEscrowV2 with wrapped native MON (WMON) as the
 *         settlement token via CreateX + CREATE3, salt `sage:escrow-wmon:v1`
 *         per ADR-0026. Same audited bytecode as the Base V3 escrow — only
 *         the token constructor arg differs. WMON has no EIP-2612 permit
 *         (WETH9-style): `createTask`'s try/catch permit falls through to
 *         `safeTransferFrom`, so clients pre-approve (SDK approve-path).
 *
 * Usage:
 *   # Dry-run on a fork:
 *   forge script script/DeployEscrowWmon.s.sol --fork-url $MONAD_TESTNET_RPC
 *
 *   # Deploy on Monad testnet:
 *   forge script script/DeployEscrowWmon.s.sol --rpc-url $MONAD_TESTNET_RPC --broadcast
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of the deployer EOA
 *   WMON_ADDRESS         — canonical wrapped-MON address on the target chain
 *   INITIAL_OWNER        — owner EOA on launch (holds setArbiter authority)
 *   INITIAL_ARBITER      — arbiter EOA on launch (calls resolveDispute)
 *
 * Notes:
 *   - Salt is NEW (`sage:escrow-wmon:v1`), not `sage:escrow:v2`: CREATE3
 *     addresses ignore initcode, so reusing the Base salt would mint the
 *     same address as the Base USDC escrow with a different token behind
 *     it — a cross-chain confusion trap. A WMON escrow deliberately lives
 *     at its own address (whitepaper §4.4 / ADR-0026).
 *   - Launch posture mirrors DeployV2: deployer/owner/arbiter collapse to
 *     one EOA; migration path is Ownable2Step transfer + setArbiter.
 */
contract DeployEscrowWmon is Script {
    // CreateX factory — same address on all supported EVM chains (ADR-0001).
    // Confirmed deployed on Monad testnet (chain 10143), recon 2026-08-10.
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address wmonAddress = vm.envAddress("WMON_ADDRESS");
        address initialOwner = vm.envAddress("INITIAL_OWNER");
        address initialArbiter = vm.envAddress("INITIAL_ARBITER");

        console2.log("Deployer:        ", deployer);
        console2.log("WMON:            ", wmonAddress);
        console2.log("Initial owner:   ", initialOwner);
        console2.log("Initial arbiter: ", initialArbiter);
        console2.log("Chain ID:        ", block.chainid);

        bytes32 escrowSalt = _buildSalt(deployer, keccak256("sage:escrow-wmon:v1"));
        console2.log("Escrow salt:     ", vm.toString(escrowSalt));

        vm.startBroadcast(deployerKey);

        bytes memory escrowInitCode = abi.encodePacked(
            type(TaskEscrowV2).creationCode,
            abi.encode(IERC20(wmonAddress), initialOwner, initialArbiter)
        );
        address escrowAddr = CREATEX.deployCreate3(escrowSalt, escrowInitCode);

        vm.stopBroadcast();

        // Post-deploy sanity reads. Cheap, catches the obvious miswiring early.
        TaskEscrowV2 escrow = TaskEscrowV2(escrowAddr);
        require(address(escrow.USDC()) == wmonAddress, "DeployEscrowWmon: token mismatch");
        require(escrow.owner() == initialOwner, "DeployEscrowWmon: owner mismatch");
        require(escrow.arbiter() == initialArbiter, "DeployEscrowWmon: arbiter mismatch");

        console2.log("");
        console2.log("=== TaskEscrowV2 (WMON) Deployment Summary ===");
        console2.log("Chain ID:        ", block.chainid);
        console2.log("TaskEscrowV2:    ", escrowAddr);
        console2.log("Settlement token:", wmonAddress);
        console2.log("Owner:           ", initialOwner);
        console2.log("Arbiter:         ", initialArbiter);
        console2.log("");
        console2.log("Record the deploy block as the reputation-indexer fromBlock (M14.4.2).");
    }

    /// @dev See DeployV2.s.sol for the salt layout rationale. Identical helper.
    function _buildSalt(address deployer, bytes32 entropyHash) internal pure returns (bytes32) {
        return bytes32(
            (uint256(uint160(deployer)) << 96) |
            (uint256(uint88(bytes11(entropyHash))))
        );
    }
}
