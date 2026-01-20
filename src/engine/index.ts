import { SupportedLanguage, FileContent, CallGraph, FileMetrics, DiffFileMetrics, LanguageAdapter } from "./types.js";
import { resolveFiles, readFiles } from "./fileUtils.js";
import { getGitDiff, getChangedLineNumbers, getFileStatus, getFileAtRef } from "./gitDiff.js";
import { BaseAdapter } from "../languages/baseAdapter.js";
import path from "path";
import fs from "fs/promises";
export * from "./types.js";

export interface FileDiff {
    path: string;
    status: 'added' | 'modified' | 'deleted';
    diff: string;
}

export interface FileSignatureChanges {
    path: string;
    status: 'added' | 'modified' | 'deleted';
    added: string[];
    modified: string[];
    removed: string[];
}

export class Engine {
    private adapters: Map<SupportedLanguage, LanguageAdapter> = new Map();

    registerAdapter(adapter: LanguageAdapter) {
        this.adapters.set(adapter.languageId, adapter);
    }

    getAdapter(languageId: SupportedLanguage): LanguageAdapter | undefined {
        return this.adapters.get(languageId);
    }

    detectLanguage(filePath: string): SupportedLanguage | undefined {
        const ext = path.extname(filePath).toLowerCase();
        switch (ext) {
            case ".sol":
                return SupportedLanguage.Solidity;
            case ".cpp":
            case ".hpp":
            case ".cc":
            case ".cxx":
            case ".c":
            case ".h":
                return SupportedLanguage.Cpp;
            case ".js":
            case ".jsx":
            case ".mjs":
            case ".cjs":
                return SupportedLanguage.JavaScript;
            case ".ts":
                return SupportedLanguage.TypeScript;
            case ".tsx":
                return SupportedLanguage.Tsx;
            case ".flow":
                return SupportedLanguage.Flow;
            case ".java":
                return SupportedLanguage.Java;
            case ".go":
                return SupportedLanguage.Go;
            case ".rs":
                return SupportedLanguage.Rust;
            case ".cairo":
                return SupportedLanguage.Cairo;
            case ".compact":
                return SupportedLanguage.Compact;
            case ".move":
                return SupportedLanguage.Move;
            case ".nr":
                return SupportedLanguage.Noir;
            case ".tolk":
                return SupportedLanguage.Tolk;
            default:
                return undefined;
        }
    }

    async processSignatures(patterns: string[]): Promise<Record<string, string[]>> {
        const filePaths = await resolveFiles(patterns);
        const files = await readFiles(filePaths);
        const filesByLanguage = this.groupFilesByLanguage(files);
        const allSignatures: Record<string, string[]> = {};

        for (const [lang, langFiles] of filesByLanguage.entries()) {
            const adapter = this.getAdapter(lang);
            if (adapter) {
                try {
                    const signatures = await adapter.extractSignatures(langFiles);
                    Object.assign(allSignatures, signatures);
                } catch (error) {
                    console.error(`Failed to extract signatures for ${lang}:`, error);
                }
            }
        }
        return allSignatures;
    }

    async processMetrics(patterns: string[]): Promise<FileMetrics[]> {
        const filePaths = await resolveFiles(patterns);
        const files = await readFiles(filePaths);
        const filesByLanguage = this.groupFilesByLanguage(files);
        const allMetrics: FileMetrics[] = [];

        for (const [lang, langFiles] of filesByLanguage.entries()) {
            const adapter = this.getAdapter(lang);
            if (adapter) {
                try {
                    const metrics = await adapter.calculateMetrics(langFiles);
                    allMetrics.push(...metrics);
                } catch (error) {
                    console.error(`Failed to calculate metrics for ${lang}:`, error);
                }
            }
        }
        return allMetrics;
    }

    async processCallGraph(patterns: string[]): Promise<CallGraph> {
        const filePaths = await resolveFiles(patterns);
        const files = await readFiles(filePaths);
        const filesByLanguage = this.groupFilesByLanguage(files);

        const combinedGraph: CallGraph = { nodes: [], edges: [] };

        for (const [lang, langFiles] of filesByLanguage.entries()) {
            const adapter = this.getAdapter(lang);
            if (adapter) {
                try {
                    const graph = await adapter.generateCallGraph(langFiles);
                    combinedGraph.nodes.push(...graph.nodes);
                    combinedGraph.edges.push(...graph.edges);
                } catch (error) {
                    console.error(`Failed to generate call graph for ${lang}:`, error);
                }
            }
        }
        return combinedGraph;
    }

    private groupFilesByLanguage(files: FileContent[]): Map<SupportedLanguage, FileContent[]> {
        const filesByLanguage = new Map<SupportedLanguage, FileContent[]>();
        for (const file of files) {
            const lang = this.detectLanguage(file.path);
            if (lang) {
                if (!filesByLanguage.has(lang)) {
                    filesByLanguage.set(lang, []);
                }
                filesByLanguage.get(lang)!.push(file);
            }
        }
        return filesByLanguage;
    }

    /**
     * Processes diff metrics between two git refs.
     *
     * @param base - Base commit/branch/tag
     * @param head - Head commit/branch/tag (defaults to HEAD)
     * @param pathFilters - Optional glob patterns to filter files
     * @param cwd - Working directory (defaults to process.cwd())
     * @returns Array of diff metrics per file
     */
    async processDiffMetrics(
        base: string,
        head: string = 'HEAD',
        pathFilters?: string[],
        cwd: string = process.cwd()
    ): Promise<DiffFileMetrics[]> {
        const fileDiffs = getGitDiff(base, head, pathFilters, cwd);
        const results: DiffFileMetrics[] = [];

        for (const fileDiff of fileDiffs) {
            const filePath = fileDiff.newPath || fileDiff.oldPath;
            const lang = this.detectLanguage(filePath);

            if (!lang) continue;

            const adapter = this.getAdapter(lang);
            if (!adapter) continue;

            const { added, removed } = getChangedLineNumbers(fileDiff);
            const status = getFileStatus(fileDiff);

            // Read file content (for non-deleted files)
            let fileContent: FileContent;
            if (status === 'deleted') {
                fileContent = { path: filePath, content: '' };
            } else {
                try {
                    const absolutePath = path.isAbsolute(filePath)
                        ? filePath
                        : path.join(cwd, filePath);
                    const content = await fs.readFile(absolutePath, 'utf-8');
                    fileContent = { path: filePath, content };
                } catch (error) {
                    console.error(`Failed to read file ${filePath}:`, error);
                    continue;
                }
            }

            try {
                const metrics = await adapter.calculateDiffMetrics(
                    fileContent,
                    added,
                    removed,
                    status
                );
                results.push(metrics);
            } catch (error) {
                console.error(`Failed to calculate diff metrics for ${filePath}:`, error);
            }
        }

        return results;
    }

    /**
     * Processes diff between two git refs and returns either raw diff or signature changes.
     *
     * @param base - Base commit/branch/tag
     * @param head - Head commit/branch/tag (defaults to HEAD)
     * @param pathFilters - Optional glob patterns to filter files
     * @param output - Output mode: 'full' for raw diff, 'signatures' for function-level changes
     * @param cwd - Working directory (defaults to process.cwd())
     * @returns Array of file diffs or signature changes depending on output mode
     */
    async processDiff(
        base: string,
        head: string = 'HEAD',
        pathFilters?: string[],
        output: 'full' | 'signatures' = 'full',
        cwd: string = process.cwd()
    ): Promise<FileDiff[] | FileSignatureChanges[]> {
        const fileDiffs = getGitDiff(base, head, pathFilters, cwd);

        if (output === 'full') {
            return this.processFullDiff(fileDiffs, base, head, cwd);
        } else {
            return this.processSignaturesDiff(fileDiffs, base, head, cwd);
        }
    }

    /**
     * Returns raw diff content per file.
     */
    private processFullDiff(
        fileDiffs: ReturnType<typeof getGitDiff>,
        _base: string,
        _head: string,
        _cwd: string
    ): FileDiff[] {
        const results: FileDiff[] = [];

        for (const fileDiff of fileDiffs) {
            const filePath = fileDiff.newPath || fileDiff.oldPath;
            const status = getFileStatus(fileDiff);

            // Reconstruct diff from hunks
            const diffLines: string[] = [];
            diffLines.push(`--- a/${fileDiff.oldPath}`);
            diffLines.push(`+++ b/${fileDiff.newPath}`);

            for (const hunk of fileDiff.hunks) {
                diffLines.push(hunk.content); // @@ -x,y +a,b @@
                for (const change of hunk.changes) {
                    if (change.type === 'insert') {
                        diffLines.push(`+${change.content}`);
                    } else if (change.type === 'delete') {
                        diffLines.push(`-${change.content}`);
                    } else {
                        diffLines.push(` ${change.content}`);
                    }
                }
            }

            results.push({
                path: filePath,
                status,
                diff: diffLines.join('\n')
            });
        }

        return results;
    }

    /**
     * Returns function-level signature changes per file.
     * Compares base and head versions to detect added/modified/removed functions.
     */
    private async processSignaturesDiff(
        fileDiffs: ReturnType<typeof getGitDiff>,
        base: string,
        _head: string,
        cwd: string
    ): Promise<FileSignatureChanges[]> {
        const results: FileSignatureChanges[] = [];

        for (const fileDiff of fileDiffs) {
            const filePath = fileDiff.newPath || fileDiff.oldPath;
            const lang = this.detectLanguage(filePath);

            if (!lang) continue;

            const adapter = this.getAdapter(lang);
            if (!adapter || !(adapter instanceof BaseAdapter)) continue;

            const status = getFileStatus(fileDiff);
            const { added: addedLines } = getChangedLineNumbers(fileDiff);

            const changes: FileSignatureChanges = {
                path: filePath,
                status,
                added: [],
                modified: [],
                removed: []
            };

            if (status === 'added') {
                // All functions in the new file are "added"
                const headContent = await this.readFileFromFs(filePath, cwd);
                if (headContent) {
                    const headFunctions = await adapter.extractSignaturesWithRanges({ path: filePath, content: headContent });
                    changes.added = headFunctions.map(f => f.signature);
                }
            } else if (status === 'deleted') {
                // All functions in the old file are "removed"
                const baseContent = getFileAtRef(base, fileDiff.oldPath, cwd);
                if (baseContent) {
                    const baseFunctions = await adapter.extractSignaturesWithRanges({ path: filePath, content: baseContent });
                    changes.removed = baseFunctions.map(f => f.signature);
                }
            } else {
                // Modified: compare base and head versions
                const baseContent = getFileAtRef(base, fileDiff.oldPath || filePath, cwd);
                const headContent = await this.readFileFromFs(fileDiff.newPath || filePath, cwd);

                if (baseContent && headContent) {
                    const baseFunctions = await adapter.extractSignaturesWithRanges({ path: filePath, content: baseContent });
                    const headFunctions = await adapter.extractSignaturesWithRanges({ path: filePath, content: headContent });

                    const baseSignatures = new Set(baseFunctions.map(f => f.signature));
                    const headSignatures = new Set(headFunctions.map(f => f.signature));

                    // Functions only in head = added
                    for (const f of headFunctions) {
                        if (!baseSignatures.has(f.signature)) {
                            changes.added.push(f.signature);
                        }
                    }

                    // Functions only in base = removed
                    for (const f of baseFunctions) {
                        if (!headSignatures.has(f.signature)) {
                            changes.removed.push(f.signature);
                        }
                    }

                    // Functions in both but with changed lines = modified
                    for (const f of headFunctions) {
                        if (baseSignatures.has(f.signature)) {
                            // Check if any added lines fall within this function's range
                            const hasChanges = addedLines.some(
                                line => line >= f.startLine && line <= f.endLine
                            );
                            if (hasChanges) {
                                changes.modified.push(f.signature);
                            }
                        }
                    }
                }
            }

            // Only include files with actual function changes
            if (changes.added.length > 0 || changes.modified.length > 0 || changes.removed.length > 0) {
                results.push(changes);
            }
        }

        return results;
    }

    /**
     * Reads file content from filesystem.
     */
    private async readFileFromFs(filePath: string, cwd: string): Promise<string | null> {
        try {
            const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(cwd, filePath);
            return await fs.readFile(absolutePath, 'utf-8');
        } catch {
            return null;
        }
    }
}
