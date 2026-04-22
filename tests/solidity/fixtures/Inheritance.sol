// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Parent {
    function parentFunc() public pure returns (uint256) {
        return 1;
    }
}

contract Child is Parent {
    function childFunc() public pure returns (uint256) {
        return parentFunc();
    }
}
