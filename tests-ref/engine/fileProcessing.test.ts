import { describe, it, expect } from 'vitest';
import { Engine } from '../../src/engine/index.js';
import { SolidityAdapter } from '../../src/languages/solidityAdapter.js';
import { SupportedLanguage } from '../../src/engine/types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('File Processing', () => {
    it('should detect Solidity language from .sol extension', () => {
        const engine = new Engine();
        const lang = engine.detectLanguage('/path/to/Contract.sol');
        expect(lang).toBe(SupportedLanguage.Solidity);
    });

    it('should return undefined for unsupported file extensions', () => {
        const engine = new Engine();
        const lang = engine.detectLanguage('/path/to/file.txt');
        expect(lang).toBeUndefined();
    });

    it('should register and retrieve adapters', () => {
        const engine = new Engine();
        const adapter = new SolidityAdapter();

        engine.registerAdapter(adapter);

        const retrieved = engine.getAdapter(SupportedLanguage.Solidity);
        expect(retrieved).toBe(adapter);
    });

    it('should return undefined for unregistered language adapters', () => {
        const engine = new Engine();
        const retrieved = engine.getAdapter(SupportedLanguage.Solidity);
        expect(retrieved).toBeUndefined();
    });
});
