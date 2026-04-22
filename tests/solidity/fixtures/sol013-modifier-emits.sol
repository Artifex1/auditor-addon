// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract ModifierEmitsTest {
    uint256 public counter;
    event Updated(uint256 value);

    // Emits AFTER the wrapped function body runs.
    modifier logsAfter() {
        _;
        emit Updated(counter);
    }

    // Emits BEFORE the wrapped function body runs.
    modifier logsBefore() {
        emit Updated(counter);
        _;
    }

    // NOT FLAGGED: modifier emits event (post-body via post_enter_hook)
    function increment() external logsAfter {
        counter += 1;
    }

    // NOT FLAGGED: modifier emits event (pre-body via pre_enter_hook)
    function decrement() external logsBefore {
        counter -= 1;
    }
}
