// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract UncheckedTransferTest {
    IERC20 public token;

    // FLAGGED: return value discarded
    function unsafeTransfer(address to, uint256 amount) external {
        token.transfer(to, amount);
    }

    // FLAGGED: return value discarded
    function unsafeTransferFrom(address from, address to, uint256 amount) external {
        token.transferFrom(from, to, amount);
    }

    // NOT FLAGGED: return value checked
    function safeTransfer(address to, uint256 amount) external {
        bool success = token.transfer(to, amount);
        require(success);
    }

    // NOT FLAGGED: return value checked in require
    function safeTransferFrom(address from, address to, uint256 amount) external {
        require(token.transferFrom(from, to, amount));
    }
}
