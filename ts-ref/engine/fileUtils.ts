import fg from 'fast-glob';
import fs from 'fs/promises';
import path from 'path';
import { FileContent } from './types.js';

export async function resolveFiles(patterns: string[], rootDir: string = process.cwd()): Promise<string[]> {
    const entries = await fg(patterns, {
        cwd: rootDir,
        absolute: true,
        onlyFiles: true,
    });
    return entries;
}

export async function readFiles(paths: string[], rootDir: string = process.cwd()): Promise<FileContent[]> {
    const results: FileContent[] = [];
    for (const p of paths) {
        try {
            const content = await fs.readFile(p, 'utf-8');
            // Convert to relative path for cleaner output
            const relativePath = path.relative(rootDir, p);
            results.push({ path: relativePath, content });
        } catch (error) {
            console.error(`Failed to read file ${p}:`, error);
            // We skip files we can't read, or we could throw. 
            // For now, skipping seems safer for bulk operations.
        }
    }
    return results;
}
