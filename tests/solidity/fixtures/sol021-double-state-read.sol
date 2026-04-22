// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract DoubleStateReadTest {
    uint256 public balance;
    uint256 public limit;

    // FLAGGED: balance read twice (1 finding on second read)
    function doubleBalance() external view returns (uint256) {
        require(balance > 0);
        return balance;
    }

    // NOT FLAGGED: only one read of balance
    function singleRead() external view returns (uint256) {
        return balance;
    }

    // NOT FLAGGED: cached in local variable
    function cached() external view returns (uint256, uint256) {
        uint256 b = balance;
        return (b, b + 1);
    }

    // FLAGGED: limit read twice (1 finding on second read)
    function doubleLimit() external view returns (bool) {
        require(limit > 100);
        return limit < 1000;
    }

    uint256 public immutable MAX_SUPPLY;
    uint256 public constant FEE = 100;

    // NOT FLAGGED: immutable variable, compiled into bytecode (no SLOAD)
    function checkMax() external view returns (bool) {
        return MAX_SUPPLY > 0 && MAX_SUPPLY < 1e18;
    }

    // NOT FLAGGED: constant variable, compiled into bytecode (no SLOAD)
    function checkFee() external view returns (bool) {
        return FEE > 0 && FEE < 1000;
    }
}
