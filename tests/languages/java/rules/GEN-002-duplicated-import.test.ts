import { describe, it, expect } from 'vitest';
import { JavaAdapter } from '../../../../src/languages/javaAdapter.js';
import { SupportedLanguage } from '../../../../src/engine/types.js';
import { buildContextForAdapter, runRule } from '../../../helpers/ruleTestUtils.js';
import rule from '../../../../src/static/rules/GEN-002-duplicated-import.js';

describe('GEN-002: Duplicated import (Java)', () => {
    it('detects duplicate import', async () => {
        const { ctx } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `import java.util.List;
import java.util.List;
public class Test {}`,
        });
        const findings = await runRule(ctx, '/Test.java', rule);
        expect(findings).toHaveLength(1);
    });

    it('does not flag unique imports', async () => {
        const { ctx } = await buildContextForAdapter(new JavaAdapter(), SupportedLanguage.Java, {
            '/Test.java': `import java.util.List;
import java.util.Map;
public class Test {}`,
        });
        const findings = await runRule(ctx, '/Test.java', rule);
        expect(findings).toHaveLength(0);
    });
});
