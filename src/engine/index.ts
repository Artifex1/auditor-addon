import { SupportedLanguage, Entrypoint, FunctionInsights, FileContent } from "./types.js";
import { resolveFiles, readFiles } from "./fileUtils.js";
import path from "path";

export * from "./types.js";

export interface LanguageAdapter {
    languageId: SupportedLanguage;
    extractEntrypoints(files: FileContent[]): Promise<Entrypoint[]>;
    extractFunctionInsights(files: FileContent[], selector: any): Promise<FunctionInsights>;
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
            default:
                return undefined;
        }
    }

    async processFiles(patterns: string[]): Promise<Entrypoint[]> {
        const filePaths = await resolveFiles(patterns);
        const files = await readFiles(filePaths);

        // Group files by language
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

        const allEntrypoints: Entrypoint[] = [];

        // Dispatch to adapters
        for (const [lang, langFiles] of filesByLanguage.entries()) {
            const adapter = this.getAdapter(lang);
            if (adapter) {
                const entrypoints = await adapter.extractEntrypoints(langFiles);
                allEntrypoints.push(...entrypoints);
            } else {
                console.warn(`No adapter found for language: ${lang}`);
            }
        }

        return allEntrypoints;
    }
}
