import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-019-missing-nonce-in-sig.js';

describe('SOL-019: Missing nonce in signature', () => {
    it('flags ECDSA.recover without nonce in hash', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
contract Foo {
    function withdraw(address _to, bytes memory _sig) external {
        bytes32 hash = keccak256(abi.encodePacked("Withdraw to: ", _to));
        address recipient = ECDSA.recover(hash, _sig);
        payable(recipient).transfer(1 ether);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('signature verification without nonce');
    });

    it('does not flag when nonce is included in hash', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
contract Foo {
    mapping(address => uint256) public nonces;
    function withdraw(address _to, bytes memory _sig) external {
        uint256 nonce = nonces[_to]++;
        bytes32 hash = keccak256(abi.encodePacked("Withdraw to: ", _to, nonce));
        address recipient = ECDSA.recover(hash, _sig);
        payable(recipient).transfer(1 ether);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('flags ecrecover without nonce', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    function verify(bytes32 hash, uint8 v, bytes32 r, bytes32 s) external view returns (address) {
        return ecrecover(hash, v, r, s);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag function without any recover call', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    function transfer(address to, uint amount) external {
        payable(to).transfer(amount);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
