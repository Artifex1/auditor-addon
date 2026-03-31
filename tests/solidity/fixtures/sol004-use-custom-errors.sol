// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract UseCustomErrorsTest {
    mapping(address => uint256) public balances;

    error InsufficientBalance(uint256 available, uint256 required);

    // Flagged: require with string message
    function withdrawString(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
    }

    // Flagged: revert with string message
    function revertString(uint256 amount) external {
        if (balances[msg.sender] < amount) {
            revert("Insufficient balance");
        }
        balances[msg.sender] -= amount;
    }

    // Flagged: require with no message
    function withdrawNoMessage(uint256 amount) external {
        require(balances[msg.sender] >= amount);
        balances[msg.sender] -= amount;
    }

    // NOT flagged: custom error in revert
    function withdrawCustom(uint256 amount) external {
        if (balances[msg.sender] < amount) {
            revert InsufficientBalance(balances[msg.sender], amount);
        }
        balances[msg.sender] -= amount;
    }
}
