// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract BroadVisibilityBase {
    uint256 private _value;

    // FLAGGED: public, never called from within this contract
    function noInternalCallers(uint256 x) public returns (uint256) {
        return x + 1;
    }

    // NOT FLAGGED: public, called internally by _dispatch
    function hasInternalCaller() public returns (uint256) {
        return _value;
    }

    function _dispatch() internal {
        hasInternalCaller();
    }

    // NOT FLAGGED: public virtual — child contracts may call super.foo()
    function virtualEntry() public virtual returns (uint256) {
        return 0;
    }

    // FLAGGED: internal, only called from within this contract
    function _onlyUsedHere() internal returns (uint256) {
        return _value * 2;
    }

    function useHelper() public {
        _onlyUsedHere();
    }

    // NOT FLAGGED: internal virtual — must stay internal for override
    function _overridable() internal virtual returns (uint256) {
        return 0;
    }
}

contract BroadVisibilityChild is BroadVisibilityBase {
    // NOT FLAGGED: internal override — must stay internal (private can't override)
    function _overridable() internal override returns (uint256) {
        return 1;
    }

    // NOT FLAGGED: internal, called from this child — parent's _sharedHelper
    // would not be flagged because this child calls it (cross-container caller)
    function _sharedHelper() internal returns (uint256) {
        return 99;
    }

    function usesShared() public {
        _sharedHelper();
    }

    function alsoUsesShared() public {
        _sharedHelper();
    }
}
