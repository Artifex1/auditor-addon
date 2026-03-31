// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract StateVisibilityTest {
    // Flagged: no explicit visibility (defaults to internal)
    uint256 implicitInternal;

    // Flagged: no explicit visibility
    address implicitOwner;

    // NOT flagged: explicit visibility
    uint256 public totalSupply;
    uint256 private counter;
    uint256 internal threshold;
}
