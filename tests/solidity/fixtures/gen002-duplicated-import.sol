// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// FLAGGED: same path imported twice
import {IERC20} from "./IERC20.sol";
import {SafeMath} from "./SafeMath.sol";
import {IERC20} from "./IERC20.sol";

// NOT FLAGGED: same path but different named imports — still duplicate source
// (both pull from the same file; they should be merged into one import)
import "./Ownable.sol";
import "./Ownable.sol";

contract Gen002Test {}
