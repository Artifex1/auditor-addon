abstract contract BaseVault {
    function pendingBalance(address user) public view virtual returns (uint256) {
        return 0;
    }
}

contract DerivedVault is BaseVault {
    function deposit() public returns (bool) {
        return true;
    }
}
