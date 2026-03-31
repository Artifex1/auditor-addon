// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract NatspecTest {
    uint256 private counter;

    // Flagged: public function with no NatSpec at all
    function increment(uint256 amount) public {
        counter += amount;
    }

    /// @notice Returns the counter value
    // Flagged: has NatSpec but missing @return
    function getCounter() external view returns (uint256) {
        return counter;
    }

    /// @notice Sets the counter
    /// @param amount The new value
    /// @return The previous value
    // NOT flagged: complete NatSpec
    function setCounter(uint256 amount) external returns (uint256) {
        uint256 prev = counter;
        counter = amount;
        return prev;
    }

    // NOT flagged: internal function — not checked
    function _helper() internal pure returns (uint256) {
        return 42;
    }
}
