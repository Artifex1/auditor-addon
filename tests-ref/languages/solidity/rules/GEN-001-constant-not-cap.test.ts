import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/GEN-001-constant-not-cap.js';

describe('GEN-001: Constant not UPPER_CASE (Solidity)', () => {
    it('detects lowercase constant', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    uint constant myConst = 42;
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('myConst');
    });

    it('does not flag UPPER_CASE constant', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {
    uint constant MY_CONST = 42;
}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
