import { describe, it, expect } from 'vitest';
import { buildContext, runRule } from './helpers.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Solidity)', () => {
    it('detects duplicate import', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
import "./Foo.sol";
import "./Foo.sol";
contract Bar {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(1);
        expect(findings[0].snippet).toContain('duplicate import');
    });

    it('does not flag unique imports', async () => {
        const { ctx } = await buildContext({
            '/test.sol': `
import "./Foo.sol";
import "./Bar.sol";
contract Baz {}`,
        });
        const findings = await runRule(ctx, '/test.sol', rule);
        expect(findings).toHaveLength(0);
    });
});
