import { describe, it, expect } from 'vitest';
import { server } from '../src/mcp/server.js';
import { SolidityAdapter } from '../src/languages/solidityAdapter.js';

describe('Smoke Test', () => {
    it('should import server instance', () => {
        expect(server).toBeDefined();
    });

    it('should instantiate SolidityAdapter', () => {
        const adapter = new SolidityAdapter();
        expect(adapter.languageId).toBe('solidity');
    });
});
