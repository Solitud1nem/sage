// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {AgentRegistry} from "../../src/AgentRegistry.sol";
import {TaskEscrow} from "../../src/TaskEscrow.sol";
import {ICreateX} from "../../src/interfaces/ICreateX.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title DeployDryRunTest
 * @notice Simulates the Deploy.s.sol flow without needing a real CreateX instance.
 *         Verifies that:
 *         - Salt construction is consistent
 *         - Both contracts deploy and initialize correctly
 *         - Constructor args are wired properly
 *
 *         For real CREATE3 deterministic address verification, use:
 *         `forge script Deploy.s.sol --fork-url $BASE_RPC`
 */
contract DeployDryRunTest is Test {
    address public deployer = makeAddr("deployer");
    address public registryOwner = makeAddr("registryOwner");

    function test_dryRun_directDeploy() public {
        MockUSDC usdc = new MockUSDC();

        // Deploy contracts directly (simulating what CreateX would do)
        AgentRegistry registry = new AgentRegistry(registryOwner);
        TaskEscrow escrow = new TaskEscrow(IERC20(address(usdc)));

        // Verify AgentRegistry initialization
        assertEq(registry.owner(), registryOwner);
        assertEq(registry.agentCount(), 0);

        // Verify TaskEscrow initialization
        assertEq(address(escrow.USDC()), address(usdc));
        assertEq(escrow.GRACE_PERIOD(), 300);
        assertEq(escrow.nextTaskId(), 0);

        console2.log("AgentRegistry deployed at:", address(registry));
        console2.log("TaskEscrow deployed at:", address(escrow));
        console2.log("USDC:", address(usdc));
    }

    function test_saltConstruction_deterministic() public pure {
        address deployer1 = address(0x1234567890AbcdEF1234567890aBcdef12345678);

        bytes32 salt1 = _buildSalt(deployer1, keccak256("sage:registry:v1"));
        bytes32 salt2 = _buildSalt(deployer1, keccak256("sage:registry:v1"));
        bytes32 salt3 = _buildSalt(deployer1, keccak256("sage:escrow:v1"));

        // Same input → same salt
        assertEq(salt1, salt2);
        // Different entropy → different salt
        assertTrue(salt1 != salt3);

        // Verify deployer is encoded in first 20 bytes
        address extractedDeployer = address(uint160(uint256(salt1) >> 96));
        assertEq(extractedDeployer, deployer1);

        // Verify byte[20] is 0x00 (chain-agnostic)
        uint8 chainFlag = uint8(uint256(salt1) >> 88) & 0xFF;
        assertEq(chainFlag, 0x00);
    }

    function test_initCode_construction() public {
        MockUSDC usdc = new MockUSDC();

        // Verify we can construct valid initCode for both contracts
        bytes memory registryInitCode = abi.encodePacked(
            type(AgentRegistry).creationCode,
            abi.encode(registryOwner)
        );
        assertTrue(registryInitCode.length > 0);

        bytes memory escrowInitCode = abi.encodePacked(
            type(TaskEscrow).creationCode,
            abi.encode(IERC20(address(usdc)))
        );
        assertTrue(escrowInitCode.length > 0);

        // Deploy using the constructed initCode (simulates what CreateX does internally)
        address registryAddr;
        assembly {
            registryAddr := create(0, add(registryInitCode, 0x20), mload(registryInitCode))
        }
        assertTrue(registryAddr != address(0), "Registry deploy failed");

        address escrowAddr;
        assembly {
            escrowAddr := create(0, add(escrowInitCode, 0x20), mload(escrowInitCode))
        }
        assertTrue(escrowAddr != address(0), "Escrow deploy failed");

        // Verify the deployed contracts work
        AgentRegistry deployedRegistry = AgentRegistry(registryAddr);
        assertEq(deployedRegistry.owner(), registryOwner);

        TaskEscrow deployedEscrow = TaskEscrow(escrowAddr);
        assertEq(address(deployedEscrow.USDC()), address(usdc));
    }

    function _buildSalt(address _deployer, bytes32 entropyHash) internal pure returns (bytes32) {
        return bytes32(
            (uint256(uint160(_deployer)) << 96) |
            (uint256(uint88(bytes11(entropyHash))))
        );
    }
}
