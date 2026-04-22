// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract ConstImmutableTest {
    // FLAGGED: could be constant (has value, never written)
    uint256 public maxSupply = 1000000;

    // FLAGGED: could be constant (has value, never written)
    address public deadAddress = address(0);

    // FLAGGED: could be immutable (only written in constructor)
    address public owner;

    // NOT FLAGGED: written outside constructor
    uint256 public counter;

    // NOT FLAGGED: already immutable
    uint256 public immutable DEPLOY_TIME;

    constructor() {
        owner = msg.sender;
        DEPLOY_TIME = block.timestamp;
    }

    function increment() external {
        counter += 1;
    }
}
