import { describe, it, expect, vi } from 'vitest';
import { BaseAdapter, AdapterConfig } from '../src/languages/baseAdapter.js';
import { SupportedLanguage } from '../src/engine/index.js';
import * as astGrepModule from '../src/util/astGrepCli.js';

// Mock astGrepCli
vi.mock('../src/util/astGrepCli.js', () => ({
    astGrep: vi.fn(),
}));

class TestAdapter extends BaseAdapter {
    constructor() {
        const config: AdapterConfig = {
            languageId: SupportedLanguage.Cpp, // Arbitrary choice
            rules: {
                comments: [],
                functions: { rule: { kind: 'function_definition' } },
                branching: { rule: { kind: 'if_statement' } }
            },
            constants: {
                baseRateNlocPerDay: 100,
                complexityMidpoint: 10,
                complexitySteepness: 5,
                complexityBenefitCap: 0.2,
                complexityPenaltyCap: 0.5,
                commentFullBenefitDensity: 20,
                commentBenefitCap: 0.2
            }
        };
        super(config);
    }
}

describe('BaseAdapter - extractSignatures', () => {
    it('should normalize whitespace in signatures', async () => {
        const adapter = new TestAdapter();
        const files = [{ path: 'test.cpp', content: 'void foo() {}' }];

        // Mock astGrep response with a function signature containing newlines and extra spaces
        const mockAstGrep = vi.mocked(astGrepModule.astGrep);
        mockAstGrep.mockResolvedValue([
            {
                text: 'void  foo(\n    int a,\n    int b\n) {',
                range: { start: { line: 0, column: 0 }, end: { line: 3, column: 3 } }
            }
        ] as any);

        const signatures = await adapter.extractSignatures(files);

        // Expectation: Newlines and multiple spaces are replaced by a single space
        // The signature extraction logic in BaseAdapter also truncates to the opening brace
        // Original logic: gets substring to '{', then trims.
        // Current logic (pre-fix) does NOT replace internal newlines.
        // We expect the fix to normalize it to "void foo( int a, int b )" or similar.

        expect(signatures['test.cpp']).toBeDefined();
        // This is what we WANT to achieve. 
        // Note: The current implementation slices up to '{'.
        // "void  foo(\n    int a,\n    int b\n)"
        // Normalization should turn this into single spaces.
        expect(signatures['test.cpp'][0]).toBe('void foo(int a, int b)');
    });
});
