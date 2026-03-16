import { describe, it, expect } from 'vitest';

describe('walker module exports', () => {
    it('exports walkShallow function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.walkShallow).toBe('function');
    });

    it('exports walkDeep function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.walkDeep).toBe('function');
    });

    it('exports findNodeAt function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.findNodeAt).toBe('function');
    });

    it('exports deduplicateInstances function', async () => {
        const mod = await import('../../src/static/walker.js');
        expect(typeof mod.deduplicateInstances).toBe('function');
    });
});
