// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// Flagged: missing security contact tag
contract NoSecurityContact {
    uint256 public value;
}

/**
 * @title SecureContract
 * @custom:security-contact security@example.com
 */
contract WithSecurityContact {
    uint256 public value;
}

// Flagged: interface with no contact info
interface INoContact {
    function foo() external;
}
