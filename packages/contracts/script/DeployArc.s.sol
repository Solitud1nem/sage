// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployArc
 * @notice Deploys AgentRegistry and TaskEscrow on Arc testnet via the
 *         Arachnid CREATE2 deployer (per ADR-0015 — CreateX is not deployed
 *         on Arc at time of writing, so the same-address property from
 *         ADR-0001 does not hold; Arc deployments will have different
 *         addresses than Base).
 *
 * Why Arachnid CREATE2 instead of plain `new`:
 *   - Determinism on Arc itself — redeploying from the same EOA + salt
 *     yields the same address, so SDK + UI references survive accidental
 *     redeploys.
 *   - The Arachnid deployer is the original deterministic deployer
 *     (canonical 0x4e59b44...), present on Arc per the official
 *     contract-addresses reference. Using it costs nothing extra and
 *     gives us a stable expectation.
 *
 * Usage:
 *   forge script script/DeployArc.s.sol \
 *     --rpc-url https://rpc.testnet.arc.network \
 *     --broadcast
 *
 * Environment variables:
 *   DEPLOYER_PRIVATE_KEY — private key of the deployer EOA (will pay USDC gas)
 *   USDC_ADDRESS         — USDC token address on Arc testnet
 *                          (0x3600000000000000000000000000000000000000)
 *   REGISTRY_OWNER       — owner address for AgentRegistry emergency pause
 *                          (deployer is fine for testnet bridge)
 *
 * Pre-deploy checklist:
 *   1. Sponsor EOA funded with testnet USDC via https://faucet.circle.com
 *      (gas on Arc is paid in USDC; ~0.02 USDC covers both deploys).
 *   2. ADR-0015 + arc-testnet-verification-2026-05-21 runbook committed.
 *
 * Post-deploy:
 *   - Verify deployed addresses on https://testnet.arcscan.app
 *   - Update packages/adapter-evm/src/chains/arc.ts with the addresses
 *   - Update apps/web/chains/arc.ts (flip PlannedChainConfig → SageChainConfig)
 *   - Smoke: cast call <TaskEscrow> "USDC()(address)" — should return
 *     the same USDC address we passed in (field is uppercase in source).
 */
contract DeployArc is Script {
    // Arachnid CREATE2 deployer — canonical address per the
    // contract-addresses reference at docs.arc.io.
    address constant ARACHNID = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address usdcAddress = vm.envAddress("USDC_ADDRESS");
        address registryOwner = vm.envAddress("REGISTRY_OWNER");

        console2.log("=== Arc testnet deploy (per ADR-0015) ===");
        console2.log("Deployer:       ", deployer);
        console2.log("USDC:           ", usdcAddress);
        console2.log("Registry owner: ", registryOwner);
        console2.log("Chain ID:       ", block.chainid);
        console2.log("Arachnid deployer:", ARACHNID);

        // Arc-specific salts. NOT the same as Base salts — addresses
        // intentionally differ per ADR-0015 (CreateX absent → ADR-0001
        // same-address property not preserved on Arc). The "arc:" prefix
        // documents the divergence; the version suffix preserves the
        // upgradable-salt convention from Base.
        bytes32 registrySalt = keccak256("sage:arc:registry:v1");
        bytes32 escrowSalt = keccak256("sage:arc:escrow:v1");

        console2.log("Registry salt:", vm.toString(registrySalt));
        console2.log("Escrow salt:  ", vm.toString(escrowSalt));

        vm.startBroadcast(deployerKey);

        // AgentRegistry init code = creation bytecode + constructor args.
        bytes memory registryInitCode = abi.encodePacked(
            type(AgentRegistry).creationCode,
            abi.encode(registryOwner)
        );
        address registry = _deployVia(registrySalt, registryInitCode);
        console2.log("");
        console2.log("AgentRegistry deployed at:", registry);

        // TaskEscrow init code = creation bytecode + constructor args.
        bytes memory escrowInitCode = abi.encodePacked(
            type(TaskEscrow).creationCode,
            abi.encode(IERC20(usdcAddress))
        );
        address escrowAddr = _deployVia(escrowSalt, escrowInitCode);
        console2.log("TaskEscrow deployed at:   ", escrowAddr);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("Chain ID:       ", block.chainid);
        console2.log("AgentRegistry:  ", registry);
        console2.log("TaskEscrow:     ", escrowAddr);
        console2.log("USDC:           ", usdcAddress);
        console2.log("Registry Owner: ", registryOwner);
        console2.log("");
        console2.log("Next: update packages/adapter-evm/src/chains/arc.ts");
        console2.log("      and apps/web/chains/arc.ts with the addresses above.");
    }

    /**
     * @dev Call the Arachnid CREATE2 deployer with (salt || initCode). The
     *      deployer's bytecode reads the first 32 bytes as the CREATE2 salt
     *      and treats the remainder as init code. Returns the deployed
     *      address computed via the CREATE2 formula.
     */
    function _deployVia(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        (bool ok, ) = ARACHNID.call(abi.encodePacked(salt, initCode));
        require(ok, "Arachnid CREATE2 deploy failed");
        deployed = vm.computeCreate2Address(salt, keccak256(initCode), ARACHNID);
        require(deployed.code.length > 0, "Deployed address has no code");
    }
}
