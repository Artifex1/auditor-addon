// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleVault {
    uint256 public totalSupply;
    mapping(address => uint256) public balances;

    function deposit(uint256 amount) external {
        balances[msg.sender] += amount;
        totalSupply += amount;
    }

    function withdraw(uint256 amount) public {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        totalSupply -= amount;
    }

    function getBalance() external view returns (uint256) {
        return balances[msg.sender];
    }

    function _internalHelper() internal pure returns (uint256) {
        return 42;
    }

    function privateFunction() private pure returns (uint256) {
        return 100;
    }
}
