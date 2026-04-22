// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// Flagged: bare import, no named symbols
import "./Token.sol";

// Flagged: aliased import, still non-explicit
import "./Utils.sol" as Utils;

// NOT flagged: explicit named import
import {IERC20} from "./IERC20.sol";

// NOT flagged: wildcard with namespace
import * as Lib from "./Lib.sol";

contract ImportTest {
    uint256 public value;
}
