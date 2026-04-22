// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract InternalCalls {
    function a() public {
        b();
    }
    function b() public {
        c();
    }
    function c() internal pure returns (uint256) {
        return 1;
    }
}
