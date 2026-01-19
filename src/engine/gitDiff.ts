import { execSync } from 'child_process';
import type { File } from 'gitdiff-parser';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gitdiffParser = require('gitdiff-parser') as { parse: (source: string) => File[] };

/**
 * Parses git diff output between two refs.
 *
 * @param base - Base commit/branch/tag
 * @param head - Head commit/branch/tag (defaults to HEAD)
 * @param paths - Optional path filters
 * @param cwd - Working directory (defaults to process.cwd())
 * @returns Array of parsed file diffs
 */
export function getGitDiff(
    base: string,
    head: string = 'HEAD',
    paths?: string[],
    cwd: string = process.cwd()
): File[] {
    const pathArgs = paths && paths.length > 0 ? ['--', ...paths] : [];
    const args = ['diff', '--no-color', `${base}...${head}`, ...pathArgs];

    let diffOutput: string;
    try {
        diffOutput = execSync(`git ${args.join(' ')}`, {
            cwd,
            encoding: 'utf-8',
            maxBuffer: 50 * 1024 * 1024 // 50MB buffer for large diffs
        });
    } catch (error) {
        if (error instanceof Error && 'stdout' in error) {
            diffOutput = (error as { stdout: string }).stdout || '';
        } else {
            throw error;
        }
    }

    if (!diffOutput.trim()) {
        return [];
    }

    return gitdiffParser.parse(diffOutput);
}

/**
 * Gets the line numbers that were added or removed in a file diff.
 */
export function getChangedLineNumbers(file: File): {
    added: number[];
    removed: number[];
} {
    const added: number[] = [];
    const removed: number[] = [];

    for (const hunk of file.hunks) {
        for (const change of hunk.changes) {
            if (change.type === 'insert') {
                added.push(change.lineNumber);
            } else if (change.type === 'delete') {
                removed.push(change.lineNumber);
            }
            // 'normal' lines are context, not changes
        }
    }

    return { added, removed };
}

/**
 * Maps gitdiff-parser file type to our status values.
 */
export function getFileStatus(file: File): 'added' | 'modified' | 'deleted' {
    if (file.type === 'add') return 'added';
    if (file.type === 'delete') return 'deleted';
    return 'modified'; // 'modify', 'rename', 'copy' all count as modified
}
