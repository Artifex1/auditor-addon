// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract TxOriginTest {
    address public owner;

    // FLAGGED: tx.origin in require (auth pattern)
    function restrictedRequire() external {
        require(tx.origin == owner);
    }

    // FLAGGED: tx.origin in if condition
    function restrictedIf() external view returns (bool) {
        if (tx.origin == owner) {
            return true;
        }
        return false;
    }

    // FLAGGED: tx.origin in assert
    function restrictedAssert() external {
        assert(tx.origin == owner);
    }

    // NOT FLAGGED: uses msg.sender correctly
    function safe() external view returns (bool) {
        return msg.sender == owner;
    }
}
