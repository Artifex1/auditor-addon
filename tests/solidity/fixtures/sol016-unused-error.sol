// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract UnusedErrorTest {
    // FLAGGED: never used
    error Stale();

    // FLAGGED: never used
    error Expired(uint256 deadline);

    // NOT FLAGGED: used in revert below
    error Unauthorized();

    function restricted() external pure {
        revert Unauthorized();
    }
}
