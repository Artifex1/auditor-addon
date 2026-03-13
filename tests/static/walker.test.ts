import { describe, it, expect } from 'vitest';
import { initialPhaseState } from '../../src/static/walker.js';

describe('initialPhaseState', () => {
    it('creates a fresh phase state', () => {
        const state = initialPhaseState();
        expect(state.currentPhase).toBe(0);
        expect(state.matched).toEqual([]);
        expect(state.evidence).toEqual([]);
    });
});

// walkPath requires parsed AST nodes (SyntaxNode from tree-sitter) and a full RuleContext.
// Comprehensive tests for walkPath need tree-sitter fixtures + real adapters.
// These will be added when the first shipped rules exist and can serve as integration test subjects.
// For now, we test the initializer and validate the contract of the module exports.

describe('walker module exports', () => {
    it('exports walkPath function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.walkPath).toBe('function');
    });

    it('exports initialPhaseState function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.initialPhaseState).toBe('function');
    });
});
