// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICreateX
 * @notice Minimal interface for the CreateX factory (0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed).
 *         Used for deterministic cross-chain deploys via CREATE3 (ADR-0001).
 * @dev See https://github.com/pcaversaccio/createx
 */
interface ICreateX {
    /// @notice Deploy a contract via CREATE3 with a caller-supplied salt.
    /// @param salt 32-byte salt. Layout interpreted by internal _guard():
    ///   - bytes[0:20] = permissioned deployer (or address(0) for open)
    ///   - byte[20]    = 0x01 for chain-bound, 0x00 for chain-agnostic
    ///   - bytes[21:32] = arbitrary entropy
    /// @param initCode The creation bytecode (including constructor args).
    /// @return newContract The deployed contract address.
    function deployCreate3(bytes32 salt, bytes memory initCode)
        external
        payable
        returns (address newContract);

    /// @notice Compute the CREATE3 address for a given salt + deployer.
    function computeCreate3Address(bytes32 salt, address deployer)
        external
        view
        returns (address);

    /// @notice Compute the CREATE3 address for a given salt using msg.sender as deployer.
    function computeCreate3Address(bytes32 salt)
        external
        view
        returns (address);
}
