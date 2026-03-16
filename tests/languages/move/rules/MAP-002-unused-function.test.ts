import { describe, it, expect } from 'vitest';
import { MoveAdapter } from '../../../../src/languages/moveAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runMapRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Move)', () => {
    it('flags unused private function', async () => {
        const { ctx, symbolMap } = await buildContextForAdapter(new MoveAdapter(), SupportedLanguage.Move, {
            '/test.move': `module 0x1::test {
    fun unused_helper(): u64 { 1 }
    public fun main(): u64 { 2 }
}`,
        });
        const findings = await runMapRule(ctx, symbolMap, rule);
        expect(findings.some(f => f.snippet.includes('unused_helper'))).toBe(true);
    });
});
