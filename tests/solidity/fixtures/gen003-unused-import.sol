// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// NOT FLAGGED: Foo used in inheritance
// FLAGGED: Bar never used
import {Foo, Bar} from "./Foo.sol";

// FLAGGED: Qux never used
import {Qux} from "./Qux.sol";

// NOT FLAGGED: Baz used as type
import {Baz} from "./Baz.sol";

contract Gen003Test is Foo {
    Baz public baz;
}
