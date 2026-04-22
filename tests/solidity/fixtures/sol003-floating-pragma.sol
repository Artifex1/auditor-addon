// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FloatingPragmaContract {
    uint256 public value;

    function get() external view returns (uint256) {
        return value;
    }
}
