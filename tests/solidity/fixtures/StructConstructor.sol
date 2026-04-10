// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract StructTest {
    struct Proposal {
        address proposer;
        uint256 amount;
    }

    enum Status { Pending, Active, Closed }

    function create(uint256 amount) external view returns (Proposal memory) {
        return Proposal(msg.sender, amount);
    }
}
