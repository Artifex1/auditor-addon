import { describe, it, expect } from 'vitest';
import { getChangedLineNumbers } from '../../src/engine/gitDiff.js';
import type { File } from 'gitdiff-parser';

// We'll test the parsing logic by importing and testing the internal parsing
// Since parseDiffOutput is private, we'll test through getChangedLineNumbers
// which depends on the parsing being correct

// Helper to create a minimal File object for testing
function createFile(overrides: Partial<File> & { hunks: File['hunks'] }): File {
    return {
        oldPath: '',
        newPath: '',
        oldEndingNewLine: true,
        newEndingNewLine: true,
        oldMode: '',
        newMode: '',
        oldRevision: '',
        newRevision: '',
        type: 'modify',
        ...overrides
    };
}

describe('Git Diff Line Number Extraction', () => {
    // These tests verify the getChangedLineNumbers utility works with gitdiff-parser types

    it('should correctly extract added lines', () => {
        const file = createFile({
            newPath: 'new.ts',
            type: 'add',
            hunks: [{
                content: '@@ -0,0 +1,3 @@',
                oldStart: 0,
                oldLines: 0,
                newStart: 1,
                newLines: 3,
                changes: [
                    { type: 'insert', content: 'line 1', lineNumber: 1, isInsert: true },
                    { type: 'insert', content: 'line 2', lineNumber: 2, isInsert: true },
                    { type: 'insert', content: 'line 3', lineNumber: 3, isInsert: true },
                ]
            }]
        });

        const { added, removed } = getChangedLineNumbers(file);

        expect(added).toEqual([1, 2, 3]);
        expect(removed).toEqual([]);
    });

    it('should correctly extract removed lines', () => {
        const file = createFile({
            oldPath: 'old.ts',
            type: 'delete',
            hunks: [{
                content: '@@ -1,2 +0,0 @@',
                oldStart: 1,
                oldLines: 2,
                newStart: 0,
                newLines: 0,
                changes: [
                    { type: 'delete', content: 'old line 1', lineNumber: 1, isDelete: true },
                    { type: 'delete', content: 'old line 2', lineNumber: 2, isDelete: true },
                ]
            }]
        });

        const { added, removed } = getChangedLineNumbers(file);

        expect(added).toEqual([]);
        expect(removed).toEqual([1, 2]);
    });

    it('should handle mixed insert/delete in a hunk', () => {
        const file = createFile({
            oldPath: 'file.ts',
            newPath: 'file.ts',
            type: 'modify',
            hunks: [{
                content: '@@ -5,2 +5,3 @@',
                oldStart: 5,
                oldLines: 2,
                newStart: 5,
                newLines: 3,
                changes: [
                    { type: 'delete', content: 'old code', lineNumber: 5, isDelete: true },
                    { type: 'delete', content: 'more old', lineNumber: 6, isDelete: true },
                    { type: 'insert', content: 'new code 1', lineNumber: 5, isInsert: true },
                    { type: 'insert', content: 'new code 2', lineNumber: 6, isInsert: true },
                    { type: 'insert', content: 'new code 3', lineNumber: 7, isInsert: true },
                ]
            }]
        });

        const { added, removed } = getChangedLineNumbers(file);

        expect(added).toEqual([5, 6, 7]);
        expect(removed).toEqual([5, 6]);
    });

    it('should handle multiple hunks', () => {
        const file = createFile({
            oldPath: 'file.ts',
            newPath: 'file.ts',
            type: 'modify',
            hunks: [
                {
                    content: '@@ -1,1 +1,1 @@',
                    oldStart: 1,
                    oldLines: 1,
                    newStart: 1,
                    newLines: 1,
                    changes: [
                        { type: 'delete', content: 'old', lineNumber: 1, isDelete: true },
                        { type: 'insert', content: 'new', lineNumber: 1, isInsert: true },
                    ]
                },
                {
                    content: '@@ -10,0 +10,2 @@',
                    oldStart: 10,
                    oldLines: 0,
                    newStart: 10,
                    newLines: 2,
                    changes: [
                        { type: 'insert', content: 'added 1', lineNumber: 10, isInsert: true },
                        { type: 'insert', content: 'added 2', lineNumber: 11, isInsert: true },
                    ]
                }
            ]
        });

        const { added, removed } = getChangedLineNumbers(file);

        expect(added).toEqual([1, 10, 11]);
        expect(removed).toEqual([1]);
    });
});
