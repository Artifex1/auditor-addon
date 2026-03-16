import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-028-hash-missing-field.js';

describe('SOL-028: Hash missing struct field', () => {
    it('flags EIP-712 hash with few fields', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Signer {
    bytes32 constant _ORDER_TYPEHASH = keccak256("Order(address maker,uint256 amount)");
    function hashOrder(address maker, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(_ORDER_TYPEHASH, maker, amount));
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('2 fields');
        expect(findings[0].snippet).toContain('TYPEHASH');
    });

    it('does not flag hash with many fields', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Signer {
    bytes32 constant _ORDER_TYPEHASH = keccak256("Order(address maker,uint256 amount,uint256 nonce,uint256 deadline)");
    function hashOrder(address maker, uint256 amount, uint256 nonce, uint256 deadline) internal pure returns (bytes32) {
        return keccak256(abi.encode(_ORDER_TYPEHASH, maker, amount, nonce, deadline));
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('does not flag non-TYPEHASH encode', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Foo {
    function hash(address a, uint b) internal pure returns (bytes32) {
        return keccak256(abi.encode(a, b));
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });

    it('flags encodePacked with TYPEHASH and few fields', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
pragma solidity ^0.8.0;
contract Signer {
    bytes32 constant _RENTAL_ORDER_TYPEHASH = keccak256("RentalOrder(bytes32 hash,address renter)");
    function deriveHash(bytes32 orderHash, address renter) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_RENTAL_ORDER_TYPEHASH, orderHash, renter));
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });
});
