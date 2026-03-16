import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-003-tx-origin.js';

describe('SOL-003: tx.origin', () => {
    it('detects tx.origin in require', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        require(tx.origin == msg.sender);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('detects tx.origin in if condition', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad() external {
        if (tx.origin == msg.sender) { revert(); }
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag tx.origin used outside conditions', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    event Origin(address);
    function info() external {
        emit Origin(tx.origin);
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
