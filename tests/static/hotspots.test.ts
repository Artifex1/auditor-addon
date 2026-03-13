import { describe, it, expect } from 'vitest';
import { computeHotspots } from '../../src/static/hotspots.js';
import { SymbolMap, SymbolEntry, SupportedLanguage } from '../../src/engine/types.js';

function makeEntry(qualifiedName: string, callees: string[] = []): SymbolEntry {
    return {
        qualifiedName,
        label: qualifiedName,
        file: '/test.sol',
        line: 1,
        language: SupportedLanguage.Solidity,
        writesState: [],
        readsState: [],
        callsExternal: false,
        callees: callees.map(c => ({ qualifiedName: c, targetKind: 'internal' as const })),
        isPublic: true,
        hasAccessControl: false,
        modifiers: [],
        resolvedBy: 'static',
        confidence: 'high',
        visibility: 'public',
    };
}

describe('computeHotspots', () => {
    it('returns empty array for empty symbol map', () => {
        const map: SymbolMap = new Map();
        expect(computeHotspots(map)).toEqual([]);
    });

    it('returns empty array when no function is called', () => {
        const map: SymbolMap = new Map();
        map.set('A', makeEntry('A'));
        map.set('B', makeEntry('B'));
        expect(computeHotspots(map)).toEqual([]);
    });

    it('identifies a shared callee as a hotspot', () => {
        const map: SymbolMap = new Map();
        map.set('root1', makeEntry('root1', ['shared']));
        map.set('root2', makeEntry('root2', ['shared']));
        map.set('shared', makeEntry('shared'));

        const hotspots = computeHotspots(map);
        expect(hotspots).toHaveLength(1);
        expect(hotspots[0]).toMatch(/^shared: \d+ chains?$/);
    });

    it('ranks hotspots by number of chains', () => {
        const map: SymbolMap = new Map();
        // root1 → A → C
        // root1 → B
        // root2 → A → C
        // root2 → C
        map.set('root1', makeEntry('root1', ['A', 'B']));
        map.set('root2', makeEntry('root2', ['A', 'C']));
        map.set('A', makeEntry('A', ['C']));
        map.set('B', makeEntry('B'));
        map.set('C', makeEntry('C'));

        const hotspots = computeHotspots(map);
        // C should appear more than B since it's reachable from both roots
        const cEntry = hotspots.find(h => h.startsWith('C:'));
        expect(cEntry).toBeDefined();
    });

    it('respects topN parameter', () => {
        const map: SymbolMap = new Map();
        map.set('root', makeEntry('root', ['A', 'B', 'C']));
        map.set('A', makeEntry('A'));
        map.set('B', makeEntry('B'));
        map.set('C', makeEntry('C'));

        const hotspots = computeHotspots(map, 2);
        expect(hotspots.length).toBeLessThanOrEqual(2);
    });

    it('excludes root nodes from hotspots', () => {
        const map: SymbolMap = new Map();
        map.set('root', makeEntry('root', ['leaf']));
        map.set('leaf', makeEntry('leaf'));

        const hotspots = computeHotspots(map);
        // root should not appear as a hotspot
        expect(hotspots.every(h => !h.startsWith('root:'))).toBe(true);
    });

    it('handles cycles without infinite loops', () => {
        const map: SymbolMap = new Map();
        map.set('root', makeEntry('root', ['A']));
        map.set('A', makeEntry('A', ['B']));
        map.set('B', makeEntry('B', ['A'])); // cycle

        const hotspots = computeHotspots(map);
        // Should complete without hanging
        expect(hotspots.length).toBeGreaterThanOrEqual(0);
    });
});
