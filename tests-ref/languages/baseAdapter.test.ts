import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAdapter, AdapterConfig } from '../../src/languages/baseAdapter.js';
import { SupportedLanguage } from '../../src/engine/types.js';
import { TreeSitterService } from '../../src/util/treeSitter.js';
import { Query } from 'web-tree-sitter';

// Mock TreeSitterService
vi.mock('../../src/util/treeSitter.js', () => ({
    TreeSitterService: {
        getInstance: vi.fn()
    }
}));

// Mock web-tree-sitter Query
vi.mock('web-tree-sitter', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        Query: vi.fn()
    };
});

class TestAdapter extends BaseAdapter {
    constructor() {
        const config: AdapterConfig = {
            languageId: SupportedLanguage.Cpp,
            queries: {
                comments: '(comment) @comment',
                functions: '(function_definition) @function',
                branching: '(if_statement) @branch'
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
    let mockParser: any;
    let mockLanguage: any;
    let mockService: any;

    beforeEach(() => {
        mockParser = {
            parse: vi.fn()
        };
        mockLanguage = {};
        mockService = {
            getLanguage: vi.fn().mockResolvedValue(mockLanguage),
            createParser: vi.fn().mockResolvedValue(mockParser)
        };
        vi.mocked(TreeSitterService.getInstance).mockReturnValue(mockService);
    });

    it('should normalize whitespace in signatures', async () => {
        const adapter = new TestAdapter();
        const content = 'void  foo(\n    int a,\n    int b\n) { /* body */ }';
        const files = [{ path: 'test.cpp', content }];

        const mockNode = {
            startIndex: 0,
            text: 'void  foo(\n    int a,\n    int b\n) {',
            childForFieldName: vi.fn().mockReturnValue({ startIndex: content.indexOf('{') }), // Mock bodyNode start
            children: []
        };

        const mockQueryInstance = {
            captures: vi.fn().mockReturnValue([{ name: 'function', node: mockNode }])
        };
        vi.mocked(Query).mockImplementation(() => mockQueryInstance as any);

        mockParser.parse.mockReturnValue({
            rootNode: {}
        });

        const signatures = await adapter.extractSignatures(files);

        expect(signatures['test.cpp']).toBeDefined();
        // The original logic gets substring to bodyNode.startIndex (30)
        // content = 'void  foo(\n    int a,\n    int b\n) {'
        // Substring(0, 30) = 'void  foo(\n    int a,\n    int b\n)'
        // cleanSignature('void  foo(\n    int a,\n    int b\n)') 
        // -> spaces replaced: 'void foo( int a, int b )'
        // -> parentheses cleaned: 'void foo(int a, int b)'
        expect(signatures['test.cpp'][0]).toBe('void foo(int a, int b)');
    });
});
