import { describe, it, expect, afterEach } from 'vitest';
import {
    writeScanState, readScanState, deleteScanState,
    ScanState
} from '../../src/static/persistence.js';
import { SymbolGraph, SupportedLanguage } from '../../src/engine/types.js';

function makeScanState(overrides?: Partial<ScanState>): ScanState {
    return {
        scanId: 'test-' + Math.random().toString(36).slice(2, 8),
        files: ['/a.sol'],
        languages: [SupportedLanguage.Solidity],
        context: {},
        effective: {
            solidity: { domain: 'on-chain', inheritanceModel: 'classical' },
        },
        graph: new SymbolGraph().toJSON(),
        gaps: [],
        status: 'ready',
        findings: [],
        sourceFiles: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

const createdIds: string[] = [];

afterEach(async () => {
    for (const id of createdIds) {
        await deleteScanState(id);
    }
    createdIds.length = 0;
});

describe('persistence', () => {
    describe('writeScanState / readScanState', () => {
        it('round-trips a scan state', async () => {
            const state = makeScanState();
            createdIds.push(state.scanId);

            await writeScanState(state);
            const loaded = await readScanState(state.scanId);

            expect(loaded).not.toBeNull();
            expect(loaded!.scanId).toBe(state.scanId);
            expect(loaded!.files).toEqual(state.files);
            expect(loaded!.languages).toEqual(state.languages);
            expect(loaded!.status).toBe('ready');
        });

        it('preserves gaps and findings', async () => {
            const state = makeScanState({
                gaps: [{
                    id: 'abc123',
                    type: 'unresolved_callee',
                    qualifiedName: 'ext.foo',
                    callSite: { file: '/a.sol', line: 10, col: 4 },
                    codeSnippet: 'ext.foo()',
                    relevantFiles: ['/a.sol'],
                    priority: 'high',
                }],
                findings: [{
                    ruleId: 'R1',
                    ruleSource: 'shipped',
                    severity: 'high',
                    title: 'Test finding',
                    confidence: 'high',
                    resolvedBy: 'static',
                    instances: [{ location: { file: '/a.sol', line: 10, col: 4 }, snippet: 'code' }],
                }],
            });
            createdIds.push(state.scanId);

            await writeScanState(state);
            const loaded = await readScanState(state.scanId);

            expect(loaded!.gaps).toHaveLength(1);
            expect(loaded!.gaps[0].type).toBe('unresolved_callee');
            expect(loaded!.findings).toHaveLength(1);
            expect(loaded!.findings[0].ruleId).toBe('R1');
        });

        it('round-trips a graph state', async () => {
            const graph = new SymbolGraph();
            graph.addNode({
                id: 'n1',
                kind: 'function',
                qualifiedName: 'Foo.bar',
                status: 'concrete',
                language: SupportedLanguage.Solidity,
                label: 'bar',
                locator: { file: '/a.sol', startIndex: 0, endIndex: 10, line: 5, column: 0 },
                visibility: 'public',
                resolvedBy: 'static',
                confidence: 'high',
            });

            const state = makeScanState({ graph: graph.toJSON() });
            createdIds.push(state.scanId);

            await writeScanState(state);
            const loaded = await readScanState(state.scanId);

            expect(loaded).not.toBeNull();
            const restoredGraph = SymbolGraph.fromJSON(loaded!.graph);
            const nodes = [...restoredGraph.nodes()];
            expect(nodes).toHaveLength(1);
            expect(nodes[0].qualifiedName).toBe('Foo.bar');
        });
    });

    describe('deleteScanState', () => {
        it('removes a persisted scan', async () => {
            const state = makeScanState();
            await writeScanState(state);
            await deleteScanState(state.scanId);
            const loaded = await readScanState(state.scanId);
            expect(loaded).toBeNull();
        });

        it('does not throw when deleting non-existent scan', async () => {
            await expect(deleteScanState('nonexistent-id')).resolves.not.toThrow();
        });
    });

    describe('readScanState', () => {
        it('returns null for non-existent scan', async () => {
            const loaded = await readScanState('does-not-exist');
            expect(loaded).toBeNull();
        });
    });
});
