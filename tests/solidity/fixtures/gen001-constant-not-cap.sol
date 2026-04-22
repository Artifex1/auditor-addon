// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// NOT FLAGGED: file-level constant, correct ALL_CAPS
uint256 constant MAX_SUPPLY = 1_000_000;

// FLAGGED: file-level constant, lowercase name
uint256 constant maxFee = 100;

// FLAGGED: file-level constant, mixed case
uint256 constant DefaultTimeout = 3600;

contract Gen001Test {
    // NOT FLAGGED: regular mutable state variable
    uint256 public counter;

    // NOT FLAGGED: immutable (excluded from rule)
    address public immutable OWNER;
    uint256 public immutable initialSupply;

    constructor(address owner, uint256 supply) {
        OWNER = owner;
        initialSupply = supply;
    }
}
