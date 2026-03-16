import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-011-div-before-mul.js';

describe('SOL-011: Division before multiplication', () => {
    it('detects (a / b) * c', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function bad(uint a, uint b, uint c) external pure returns (uint) {
        return (a / b) * c;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag (a * b) / c', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    function ok(uint a, uint b, uint c) external pure returns (uint) {
        return (a * b) / c;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
