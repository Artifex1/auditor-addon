import { Parser, Language } from 'web-tree-sitter';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { SupportedLanguage } from '../engine/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the parsers directory.
// In production (bundled), we expect them in a 'parsers' folder next to the bundle.
// In development (running from src/util), we look for them in the dist folder.
const BUNDLED_PATH = path.join(__dirname, 'parsers');
const DEV_PATH = path.join(__dirname, '..', '..', 'dist', 'mcp', 'parsers');
const PARSERS_DIR = fs.existsSync(BUNDLED_PATH) ? BUNDLED_PATH : DEV_PATH;

export class TreeSitterService {
    private static instance: TreeSitterService;
    private initialized = false;
    private languages: Map<SupportedLanguage, Language> = new Map();

    private constructor() { }

    public static getInstance(): TreeSitterService {
        if (!TreeSitterService.instance) {
            TreeSitterService.instance = new TreeSitterService();
        }
        return TreeSitterService.instance;
    }

    /**
     * Initialize web-tree-sitter
     */
    public async init(): Promise<void> {
        if (this.initialized) return;

        await Parser.init();
        this.initialized = true;
    }

    /**
     * Get or load a language parser
     */
    public async getLanguage(lang: SupportedLanguage): Promise<Language> {
        if (!this.initialized) {
            await this.init();
        }

        if (this.languages.has(lang)) {
            return this.languages.get(lang)!;
        }

        const wasmName = this.mapLanguageToWasm(lang);
        const wasmPath = path.join(PARSERS_DIR, wasmName);

        if (!fs.existsSync(wasmPath)) {
            throw new Error(`WASM parser not found for language ${lang} at ${wasmPath}`);
        }

        try {
            const language = await Language.load(wasmPath);
            this.languages.set(lang, language);
            return language;
        } catch (error) {
            throw new Error(`Failed to load WASM parser for ${lang}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Create a new parser instance for a language
     */
    public async createParser(lang: SupportedLanguage): Promise<Parser> {
        const language = await this.getLanguage(lang);
        const parser = new Parser();
        parser.setLanguage(language);
        return parser;
    }

    private mapLanguageToWasm(lang: SupportedLanguage): string {
        switch (lang) {
            case SupportedLanguage.Solidity:
                return 'tree-sitter-solidity.wasm';
            case SupportedLanguage.Java:
                return 'tree-sitter-java.wasm';
            case SupportedLanguage.Go:
                return 'tree-sitter-go.wasm';
            case SupportedLanguage.Rust:
                return 'tree-sitter-rust.wasm';
            case SupportedLanguage.Cpp:
                return 'tree-sitter-cpp.wasm';
            case SupportedLanguage.JavaScript:
                return 'tree-sitter-javascript.wasm';
            case SupportedLanguage.TypeScript:
                return 'tree-sitter-typescript.wasm';
            case SupportedLanguage.Tsx:
                return 'tree-sitter-tsx.wasm';
            case SupportedLanguage.Flow:
                return 'tree-sitter-flow.wasm';
            case SupportedLanguage.Cairo:
                return 'tree-sitter-cairo.wasm';
            case SupportedLanguage.Compact:
                return 'tree-sitter-compact.wasm';
            case SupportedLanguage.Move:
                return 'tree-sitter-move-sui.wasm'; // Note: Move uses tree-sitter-move-sui.wasm
            case SupportedLanguage.Noir:
                return 'tree-sitter-noir.wasm';
            case SupportedLanguage.Tolk:
                return 'tree-sitter-tolk.wasm';
            case SupportedLanguage.Masm:
                return 'tree-sitter-masm.wasm';
            default:
                console.warn(`No explicit WASM mapping for ${lang}, falling back to convention.`);
                return `tree-sitter-${(lang as string).toLowerCase()}.wasm`;
        }
    }
}

/**
 * Convenience helper to get a parser for a language
 */
export async function getParser(lang: SupportedLanguage): Promise<Parser> {
    return TreeSitterService.getInstance().createParser(lang);
}
