// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// ── positive: base with 2+ children overriding the same virtual function ──

contract Base {
    function _compute(uint256 x) internal virtual returns (uint256) {
        return x;
    }

    function _hook() internal virtual {}
}

contract ChildA is Base {
    function _compute(uint256 x) internal override returns (uint256) {
        return x + 1;
    }

    function _hook() internal override {}
}

contract ChildB is Base {
    function _compute(uint256 x) internal override returns (uint256) {
        return x * 2;
    }

    function _hook() internal override {}
}

// ── negative: only one child overrides ──

contract SingleChild is Base {
    function _compute(uint256 x) internal override returns (uint256) {
        return x - 1;
    }
}

// ── negative: base with no virtual functions ──

contract Plain {
    function foo() public pure returns (uint256) { return 1; }
}

contract PlainChildA is Plain {}
contract PlainChildB is Plain {}
