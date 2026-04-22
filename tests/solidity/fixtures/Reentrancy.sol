// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Reentrancy {
    mapping(address => uint256) public balances;

    // Vulnerable: external call before state update
    function withdrawVulnerable(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
        balances[msg.sender] -= amount;
    }

    // Safe: state update before external call
    function withdrawSafe(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // Vulnerable: external call in helper, state write in caller
    function withdrawNested(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient");
        _doTransfer(amount);
        balances[msg.sender] -= amount;
    }

    function _doTransfer(uint256 amount) internal {
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    // Safe nested: state write in helper before external call in caller
    function withdrawNestedSafe(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient");
        _updateBalance(amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function _updateBalance(uint256 amount) internal {
        balances[msg.sender] -= amount;
    }
}
