import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/mcp/server.ts'],
    format: ['esm'],
    outDir: 'dist/mcp',
    clean: true,
    noExternal: [/(.*)/],
    sourcemap: true,
    dts: false,
    splitting: false,
});
