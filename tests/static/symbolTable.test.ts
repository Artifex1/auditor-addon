import { describe, it, expect } from 'vitest';
import { detectGaps, SymbolGap } from '../../src/static/symbol-table.js';
import { SymbolMap, SymbolEntry, SupportedLanguage, CallTargetKind } from '../../src/engine/types.js';

function makeEntry(overrides: Partial<SymbolEntry> & { qualifiedName: string; file: string }): SymbolEntry {
    return {
        line: 1,
        language: SupportedLanguage.Solidity,
        label: overrides.qualifiedName.split('.').pop() ?? overrides.qualifiedName,
        writesState: [],
        readsState: [],
        callsExternal: false,
        callees: [],
        isPublic: false,
        hasAccessControl: false,
        modifiers: [],
        resolvedBy: 'static',
        confidence: 'high',
        visibility: 'private',
        ...overrides,
    };
}

describe('detectGaps', () => {
    it('returns no gaps when all callees are internal and resolved', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'B', targetKind: 'internal' }],
        }));
        map.set('B', makeEntry({ qualifiedName: 'B', file: '/a.sol' }));

        const gaps = detectGaps(map);
        expect(gaps).toHaveLength(0);
    });

    it('creates a gap for external_unknown callee', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'ext.foo', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('unresolved_callee');
        expect(gaps[0].qualifiedName).toBe('ext.foo');
    });

    it('creates a gap for interface_dispatch callee', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'IFoo.bar', targetKind: 'interface_dispatch' }],
        }));

        const gaps = detectGaps(map);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('interface_impl');
    });

    it('creates a gap when callee does not exist in map', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'missing', targetKind: 'internal' }],
        }));

        const gaps = detectGaps(map);
        expect(gaps).toHaveLength(1);
        expect(gaps[0].type).toBe('external_library');
        expect(gaps[0].qualifiedName).toBe('missing');
    });

    it('assigns high priority when caller is in hotspot set', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map, ['A: 5 chains']);
        expect(gaps[0].priority).toBe('high');
    });

    it('assigns medium priority for public caller not in hotspots', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol', isPublic: true,
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map, []);
        expect(gaps[0].priority).toBe('medium');
    });

    it('assigns low priority for private caller not in hotspots', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map, []);
        expect(gaps[0].priority).toBe('low');
    });

    it('generates stable deterministic gap IDs', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol', line: 10,
            range: { start: { line: 10, column: 4 }, end: { line: 15, column: 1 } },
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps1 = detectGaps(map);
        const gaps2 = detectGaps(map);
        expect(gaps1[0].id).toBe(gaps2[0].id);
        expect(gaps1[0].id).toMatch(/^[0-9a-f]{12}$/);
    });

    it('includes caller file in relevantFiles', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map);
        expect(gaps[0].relevantFiles).toContain('/a.sol');
        expect(gaps[0].callSite.file).toBe('/a.sol');
    });

    it('extracts code snippet when sourceFiles provided', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol', line: 3,
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const sourceFiles = new Map([
            ['/a.sol', 'line1\nline2\nline3\nline4\nline5'],
        ]);

        const gaps = detectGaps(map, [], sourceFiles);
        expect(gaps[0].codeSnippet).toContain('line1');
        expect(gaps[0].codeSnippet).toContain('line3');
    });

    it('returns empty snippet when no sourceFiles', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [{ qualifiedName: 'ext', targetKind: 'external_unknown' }],
        }));

        const gaps = detectGaps(map);
        expect(gaps[0].codeSnippet).toBe('');
    });

    it('detects multiple gaps from one caller', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry({
            qualifiedName: 'A', file: '/a.sol',
            callees: [
                { qualifiedName: 'ext1', targetKind: 'external_unknown' },
                { qualifiedName: 'ext2', targetKind: 'interface_dispatch' },
            ],
        }));

        const gaps = detectGaps(map);
        expect(gaps).toHaveLength(2);
        expect(gaps.map(g => g.qualifiedName)).toEqual(['ext1', 'ext2']);
    });
});
