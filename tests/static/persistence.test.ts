import { describe, it, expect, afterEach } from 'vitest';
import {
    writeScanState, readScanState, deleteScanState,
    symbolMapToRecord, recordToSymbolMap,
    ScanState
} from '../../src/static/persistence.js';
import { SymbolMap, SymbolEntry, SupportedLanguage } from '../../src/engine/types.js';

function makeScanState(overrides?: Partial<ScanState>): ScanState {
    return {
        scanId: 'test-' + Math.random().toString(36).slice(2, 8),
        files: ['/a.sol'],
        languages: [SupportedLanguage.Solidity],
        context: {},
        effective: {
            solidity: { domain: 'on-chain', inheritanceModel: 'classical' },
        },
        symbolMap: {},
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

    describe('symbolMapToRecord / recordToSymbolMap', () => {
        it('round-trips a symbol map', () => {
            const entry: SymbolEntry = {
                qualifiedName: 'Foo.bar',
                label: 'bar',
                file: '/a.sol',
                line: 5,
                language: SupportedLanguage.Solidity,
                writesState: ['x'],
                readsState: ['y'],
                callsExternal: false,
                callees: [{ qualifiedName: 'Foo.baz', targetKind: 'internal' }],
                isPublic: true,
                hasAccessControl: false,
                modifiers: [],
                resolvedBy: 'static',
                confidence: 'high',
                visibility: 'public',
            };

            const map: SymbolMap = new Map();
            map.set('Foo.bar', entry);

            const record = symbolMapToRecord(map);
            expect(record['Foo.bar']).toBeDefined();
            expect(record['Foo.bar'].qualifiedName).toBe('Foo.bar');

            const restored = recordToSymbolMap(record);
            expect(restored.size).toBe(1);
            expect(restored.get('Foo.bar')?.callees).toHaveLength(1);
        });

        it('handles empty map', () => {
            const map: SymbolMap = new Map();
            const record = symbolMapToRecord(map);
            expect(Object.keys(record)).toHaveLength(0);

            const restored = recordToSymbolMap(record);
            expect(restored.size).toBe(0);
        });
    });
});
