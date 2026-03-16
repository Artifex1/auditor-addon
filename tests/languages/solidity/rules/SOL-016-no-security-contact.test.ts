import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/SOL-016-no-security-contact.js';

describe('SOL-016: No security contact', () => {
    it('detects missing @custom:security-contact', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag when present', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
/// @custom:security-contact security@example.com
contract Foo {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
