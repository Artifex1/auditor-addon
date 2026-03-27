// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MissingVisibility {
    function hasVisibility() public pure returns (uint256) {
        return 1;
    }

    function noVisibility() returns (uint256) {
        return 2;
    }
}
