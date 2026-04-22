// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

contract UncheckedCallTest {
    // FLAGGED: return value discarded
    function uncheckedCall(address to) external {
        to.call("");
    }

    // FLAGGED: return value discarded
    function uncheckedSend(address payable to) external {
        to.send(1 ether);
    }

    // FLAGGED: return value discarded
    function uncheckedDelegatecall(address impl) external {
        impl.delegatecall("");
    }

    // NOT FLAGGED: return value assigned
    function checkedCall(address to) external {
        (bool success, ) = to.call("");
        require(success);
    }

    // NOT FLAGGED: return value used in if
    function checkedInIf(address to) external {
        (bool ok, ) = to.call("");
        if (!ok) revert();
    }

    // NOT FLAGGED: return value assigned to variable
    function checkedSend(address payable to) external {
        bool sent = to.send(1 ether);
        require(sent);
    }
}
