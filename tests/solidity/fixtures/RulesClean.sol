// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "./IERC20.sol";

/**
 * @title CleanContract
 * @notice A contract that satisfies all shipped rules.
 * @custom:security-contact security@example.com
 */
contract CleanContract {
    /// @notice The total supply
    uint256 public totalSupply;

    /// @notice Owner address
    address private owner;

    /// @notice Balances per address
    mapping(address holder => uint256 balance) public balances;

    error InsufficientBalance(uint256 have, uint256 need);
    error Unauthorized();

    /// @notice Deposit tokens
    /// @param amount Number of tokens to deposit
    function deposit(uint256 amount) external {
        if (msg.sender != owner) revert Unauthorized();
        if (amount == 0) revert InsufficientBalance(0, 1);
        balances[msg.sender] += amount;
        totalSupply += amount;
    }

    /// @notice Withdraw tokens
    /// @param amount Number of tokens to withdraw
    function withdraw(uint256 amount) external {
        if (balances[msg.sender] < amount) {
            revert InsufficientBalance(balances[msg.sender], amount);
        }
        balances[msg.sender] -= amount;
        totalSupply -= amount;
    }

    /// @notice Process raw calldata
    /// @param data The calldata to process
    /// @return hash Keccak256 of the input
    function process(bytes calldata data) external pure returns (bytes32 hash) {
        return keccak256(data);
    }

    /// @notice Get caller's balance
    /// @return balance The caller's token balance
    function getBalance() external view returns (uint256 balance) {
        return balances[msg.sender];
    }
}
