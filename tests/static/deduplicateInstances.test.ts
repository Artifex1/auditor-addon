import { describe, it, expect } from 'vitest';
import { deduplicateInstances } from '../../src/static/walker.js';
import { FindingInstance } from '../../src/engine/types.js';

describe('deduplicateInstances', () => {
    it('keeps a single instance unchanged', () => {
        const instances: FindingInstance[] = [
            { location: { file: '/a.sol', line: 10, col: 0 }, snippet: 'code' },
        ];
        expect(deduplicateInstances(instances)).toHaveLength(1);
    });

    it('removes exact location duplicates, keeping the one with the longer path', () => {
        const instances: FindingInstance[] = [
            {
                location: { file: '/a.sol', line: 10, col: 0 },
                snippet: 'short',
                executionPath: ['A'],
            },
            {
                location: { file: '/a.sol', line: 10, col: 0 },
                snippet: 'long',
                executionPath: ['A', 'B', 'C'],
            },
        ];
        const result = deduplicateInstances(instances);
        expect(result).toHaveLength(1);
        expect(result[0].executionPath).toEqual(['A', 'B', 'C']);
    });

    it('keeps instances at different locations', () => {
        const instances: FindingInstance[] = [
            { location: { file: '/a.sol', line: 10, col: 0 }, snippet: 'a' },
            { location: { file: '/a.sol', line: 20, col: 0 }, snippet: 'b' },
            { location: { file: '/b.sol', line: 10, col: 0 }, snippet: 'c' },
        ];
        expect(deduplicateInstances(instances)).toHaveLength(3);
    });

    it('removes sub-paths that are suffixes of a longer path', () => {
        const instances: FindingInstance[] = [
            {
                location: { file: '/a.sol', line: 10, col: 0 },
                snippet: 'long',
                executionPath: ['A', 'B', 'C'],
            },
            {
                location: { file: '/b.sol', line: 5, col: 0 },
                snippet: 'short',
                executionPath: ['B', 'C'],
            },
        ];
        const result = deduplicateInstances(instances);
        expect(result).toHaveLength(1);
        expect(result[0].executionPath).toEqual(['A', 'B', 'C']);
    });

    it('keeps paths that are not suffixes of each other', () => {
        const instances: FindingInstance[] = [
            {
                location: { file: '/a.sol', line: 10, col: 0 },
                snippet: 'a',
                executionPath: ['A', 'B'],
            },
            {
                location: { file: '/b.sol', line: 5, col: 0 },
                snippet: 'b',
                executionPath: ['C', 'D'],
            },
        ];
        expect(deduplicateInstances(instances)).toHaveLength(2);
    });

    it('handles empty input', () => {
        expect(deduplicateInstances([])).toEqual([]);
    });

    it('handles instances without executionPath', () => {
        const instances: FindingInstance[] = [
            { location: { file: '/a.sol', line: 10, col: 0 }, snippet: 'a' },
            { location: { file: '/b.sol', line: 20, col: 0 }, snippet: 'b' },
        ];
        expect(deduplicateInstances(instances)).toHaveLength(2);
    });
});
