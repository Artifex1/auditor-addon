// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice This is a documented contract
contract Documented {
    // Internal state variable
    uint256 private value;

    /// @notice Sets the value
    /// @param newValue The new value to set
    function setValue(uint256 newValue) public {
        value = newValue;
    }
}
