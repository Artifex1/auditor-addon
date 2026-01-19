import { SupportedLanguage, FileContent, CallGraph, FileMetrics, LanguageAdapter } from "./types.js";
import { resolveFiles, readFiles } from "./fileUtils.js";
import path from "path";
export * from "./types.js";

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
}
