// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract StateUpdateNoEventTest {
    uint256 public counter;
    address public owner;

    event CounterUpdated(uint256 newValue);
    event OwnerChanged(address newOwner);

    // FLAGGED: writes state, no event
    function increment() external {
        counter += 1;
    }

    // FLAGGED: writes state, no event
    function setOwner(address newOwner) public {
        owner = newOwner;
    }

    // NOT FLAGGED: writes state AND emits event
    function incrementWithEvent() external {
        counter += 1;
        emit CounterUpdated(counter);
    }

    // NOT FLAGGED: view function
    function getCounter() external view returns (uint256) {
        return counter;
    }

    // NOT FLAGGED: private helper
    function _update(uint256 val) private {
        counter = val;
    }
}
