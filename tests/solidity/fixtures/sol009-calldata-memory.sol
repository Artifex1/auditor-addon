// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract CalldataTest {
    // Flagged: external function with memory bytes parameter
    function processBytes(bytes memory data) external returns (bytes32) {
        return keccak256(data);
    }

    // Flagged: external function with memory string parameter
    function processString(string memory label) external returns (bytes32) {
        return keccak256(bytes(label));
    }

    // NOT flagged: calldata is used correctly
    function processBytesOk(bytes calldata data) external returns (bytes32) {
        return keccak256(data);
    }

    // NOT flagged: internal function — calldata not applicable
    function _internal(bytes memory data) internal returns (bytes32) {
        return keccak256(data);
    }

    // NOT flagged: memory in return type is fine
    function getBytes() external pure returns (bytes memory) {
        return hex"deadbeef";
    }
}
