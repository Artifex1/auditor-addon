import { describe, it, expect } from 'vitest';
import { RustAdapter } from '../../../../src/languages/rustAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runMapRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/MAP-002-unused-function.js';

describe('MAP-002: Unused function (Rust)', () => {
    it('flags unused private function', async () => {
        const { ctx, graph } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `fn unused_helper() -> u32 { 1 }
pub fn main() -> u32 { 2 }`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('unused_helper'))).toBe(true);
    });

    it('does not flag called function', async () => {
        const { ctx, graph } = await buildContextForAdapter(new RustAdapter(), SupportedLanguage.Rust, {
            '/test.rs': `fn helper() -> u32 { 1 }
pub fn main() -> u32 { helper() }`,
        });
        const findings = await runMapRule(ctx, graph, rule);
        expect(findings.some(f => f.snippet.includes('helper'))).toBe(false);
    });
});
