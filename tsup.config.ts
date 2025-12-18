import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/mcp/server.ts'],
    format: ['esm'],
    outDir: 'dist/mcp',
    clean: false,
    noExternal: [/(.*)/],
    sourcemap: true,
    dts: false,
    splitting: false,
    shims: true,
    banner: {
        js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
    },
});
