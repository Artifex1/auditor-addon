// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract DivBeforeMul {

    // FLAGGED: inline (a / b) * c
    function inlineLeft(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        return (a / b) * c;
    }

    // FLAGGED: inline reversed — c * (a / b)
    function inlineRight(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        return c * (a / b);
    }

    // FLAGGED: division stored in variable, then multiplied
    function viaVariable(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        uint256 ratio = a / b;
        return ratio * c;
    }

    // FLAGGED: variable reassigned with division, then multiplied
    function viaReassignment(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        uint256 x = a;
        x = a / b;
        return x * c;
    }

    // NOT FLAGGED: variable cleared before multiplication
    function clearedBeforeMul(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        uint256 x = a / b;
        x = c;         // taint cleared — x no longer holds division result
        return x * 10;
    }

    // NOT FLAGGED: correct order — multiply first, then divide
    function mulFirst(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        return (a * c) / b;
    }

    // NOT FLAGGED: division result added, not multiplied
    function divThenAdd(uint256 a, uint256 b, uint256 c) public pure returns (uint256) {
        return (a / b) + c;
    }
}
