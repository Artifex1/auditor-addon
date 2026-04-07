// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract UnusedFunctions {
    uint256 private counter;

    constructor() {
        counter = 0;
    }

    // FLAGGED: private, never called
    function _deadPrivate() private pure returns (uint256) {
        return 42;
    }

    // FLAGGED: internal, never called
    function _deadInternal() internal pure returns (uint256) {
        return 99;
    }

    // NOT FLAGGED: private but called by doWork
    function _helper() private pure returns (uint256) {
        return 7;
    }

    // NOT FLAGGED: public visibility
    function publicFn() public pure returns (uint256) {
        return 1;
    }

    // NOT FLAGGED: external visibility
    function doWork() external pure returns (uint256) {
        return _helper();
    }

    // NOT FLAGGED: receive is exempt
    receive() external payable {}

    // NOT FLAGGED: fallback is exempt
    fallback() external payable {}
}

contract Base {
    function _hook() internal virtual returns (uint256) { return 0; }
    function execute() external returns (uint256) { return _hook(); }
}

contract Child is Base {
    // NOT FLAGGED: override of virtual that has callers in parent
    function _hook() internal override returns (uint256) { return 42; }

    // FLAGGED: truly dead internal
    function _noOneCallsMe() internal pure returns (uint256) { return 99; }
}
