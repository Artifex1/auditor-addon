import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-014-double-state-read.js';

describe('SOL-014: Double state read', () => {
    it('detects redundant storage read', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    mapping(address => uint) balances;
    function check(address a) external view returns (uint) {
        uint x = balances[a];
        uint y = balances[a];
        return x + y;
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        expect(findings[0].snippet).toContain('redundant state read');
    });

    it('does not flag after intervening write', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    mapping(address => uint) balances;
    function update(address a, uint v) external {
        uint x = balances[a];
        balances[a] = v;
        uint y = balances[a];
    }
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
