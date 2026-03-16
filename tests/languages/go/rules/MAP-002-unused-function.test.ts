import { describe, it, expect } from 'vitest';
import { GoAdapter } from '../../../../src/languages/goAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runMapRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Go)', () => {
    it('flags unused unexported function', async () => {
        const { ctx, symbolMap } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
func unusedHelper() int { return 1 }
func Main() int { return 2 }`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings.some(f => f.snippet.includes('unusedHelper'))).toBe(true);
    });

    it('does not flag called function', async () => {
        const { ctx, symbolMap } = await buildContextForAdapter(new GoAdapter(), SupportedLanguage.Go, {
            '/test.go': `package main
func helper() int { return 1 }
func Main() int { return helper() }`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings.some(f => f.snippet.includes('helper'))).toBe(false);
    });
});
