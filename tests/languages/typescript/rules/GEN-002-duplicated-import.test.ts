import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../../../../src/languages/javascriptAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (TypeScript)', () => {
    it('detects duplicate import', async () => {
        const { ctx } = await buildContextForAdapter(new TypeScriptAdapter(), SupportedLanguage.TypeScript, {
            '/test.ts': `import { foo } from './foo';
import { foo } from './foo';
export function main() {}`,
        });
        const findings = await runRule(ctx, '/test.ts', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag unique imports', async () => {
        const { ctx } = await buildContextForAdapter(new TypeScriptAdapter(), SupportedLanguage.TypeScript, {
            '/test.ts': `import { foo } from './foo';
import { bar } from './bar';
export function main() {}`,
        });
        const findings = await runRule(ctx, '/test.ts', rule);
        expect(findings).toHaveLength(0);
    });
});
