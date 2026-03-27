// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract GapScenarios {
    IERC20 public token;
    address public admin;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    function withdrawToken(address to, uint256 amount) external onlyAdmin {
        token.transfer(to, amount);
    }

    function computeHash(bytes memory data) external pure returns (bytes32) {
        return _hashData(data);
    }

    function _internalCheck(uint256 x) internal pure returns (bool) {
        return x > 0;
    }

    function doCheck(uint256 val) external view returns (bool) {
        return _internalCheck(val);
    }
}
