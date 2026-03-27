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

    /// Calls an interface method — receiver is a state variable typed as IERC20.
    /// The adapter cannot know which concrete contract implements IERC20.transfer.
    function withdrawToken(address to, uint256 amount) external onlyAdmin {
        token.transfer(to, amount);
    }

    /// Calls a free function defined in another file not included in the scope.
    /// Should produce an unresolved_callee gap.
    function computeHash(bytes memory data) external pure returns (bytes32) {
        return _hashData(data);
    }

    /// Internal helper that the adapter CAN resolve — no gap expected.
    function _internalCheck(uint256 x) internal pure returns (bool) {
        return x > 0;
    }

    /// Calls the internal helper — should be fully resolved, no gap.
    function doCheck(uint256 val) external view returns (bool) {
        return _internalCheck(val);
    }
}
