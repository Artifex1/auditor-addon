// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract UnusedEventTest {
    // FLAGGED: never emitted
    event Stale(address indexed who);

    // FLAGGED: never emitted
    event Deprecated();

    // NOT FLAGGED: emitted below
    event Transfer(address indexed from, address indexed to, uint256 amount);

    function transfer(address to, uint256 amount) external {
        emit Transfer(msg.sender, to, amount);
    }
}
