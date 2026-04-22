// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract SuperBase {
    event ActionPerformed(uint256 value);
    uint256 internal value;

    function _hook() internal virtual returns (uint256) { return 0; }
    function run() external returns (uint256) { return _hook(); }

    function _doAction(uint256 v) internal virtual {
        value = v;
        emit ActionPerformed(v);
    }
}

contract SuperChild is SuperBase {
    // SOL-023: NOT FLAGGED — super._hook() resolves to SuperBase._hook which has callers
    function _hook() internal override returns (uint256) {
        return super._hook() + 1;
    }

    // SOL-013: NOT FLAGGED — writes state but super._doAction emits event
    function performAction(uint256 v) external {
        value = v;
        super._doAction(v);
    }
}
