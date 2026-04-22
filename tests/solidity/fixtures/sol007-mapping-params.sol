// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract MappingParamsTest {
    // Flagged: no named key or value
    mapping(address => uint256) public balances;

    // Flagged: missing value identifier
    mapping(address owner => uint256) public partial;

    // NOT flagged: both key and value are named
    mapping(address owner => uint256 balance) public named;

    // Flagged: nested mapping outer level missing names
    mapping(address => mapping(uint256 => bool)) public nested;
}
