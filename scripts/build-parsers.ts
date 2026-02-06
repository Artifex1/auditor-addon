import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const GRAMMARS_DIR = path.join(ROOT_DIR, 'vendor', 'grammars');
const PATCHES_DIR = path.join(ROOT_DIR, 'vendor', 'patches');
const PARSERS_DIR = path.join(ROOT_DIR, 'dist', 'mcp', 'parsers');

// Use the host project's CLI to avoid version conflicts within submodules
const TREE_SITTER_CLI = path.resolve(ROOT_DIR, 'node_modules', '.bin', 'tree-sitter');

const filter = process.argv[2];

if (!fs.existsSync(PARSERS_DIR)) {
    fs.mkdirSync(PARSERS_DIR, { recursive: true });
}

interface GrammarTarget {
    path: string;
    folderName: string;
}

/**
 * Recursively finds directories containing a 'grammar.js' file.
 * Optimization: Uses withFileTypes to avoid extra stat calls.
 */
function findGrammarPaths(dir: string): GrammarTarget[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return [];
    }

    // specific check: if this dir has grammar.js, we stop here.
    if (entries.some(e => e.name === 'grammar.js' && e.isFile())) {
        return [{
            path: dir,
            folderName: path.basename(dir)
        }];
    }

    let results: GrammarTarget[] = [];
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            results = results.concat(findGrammarPaths(path.join(dir, entry.name)));
        }
    }
    return results;
}

// Optimization: We scan ALL vendor dirs first, then filter by the Resolved Name later.
// This allows filtering for 'tsx' even if it lives inside 'tree-sitter-typescript'.
const vendorDirs = fs.readdirSync(GRAMMARS_DIR).filter(name => 
    fs.statSync(path.join(GRAMMARS_DIR, name)).isDirectory()
);

console.log(`Scanning ${vendorDirs.length} vendor folders...`);

for (const vendorName of vendorDirs) {
    const vendorPath = path.join(GRAMMARS_DIR, vendorName);
    const grammarTargets = findGrammarPaths(vendorPath);

    if (grammarTargets.length === 0) {
        // Quietly skip empty/utility folders unless verbose
        continue;
    }

    for (const target of grammarTargets) {
        let langName = target.folderName;
        if (langName === 'src') continue; 

        // Naming Normalization Logic
        if (!langName.startsWith('tree-sitter-')) {
            // If the parent folder (vendorName) matches the target folder (e.g. tree-sitter-python/tree-sitter-python)
            // or if we are in a subfolder like 'typescript/tsx'
            if (vendorName.startsWith('tree-sitter-') && vendorName.includes(langName)) {
                 langName = `tree-sitter-${langName}`;
            } else if (vendorName.startsWith('tree-sitter-')) {
                 // Fallback for monorepos: tree-sitter-typescript/tsx -> tree-sitter-tsx
                 langName = `tree-sitter-${langName}`;
            } else {
                 langName = vendorName;
            }
        }

        // Optimization: Apply filter HERE, after we know the real language name
        if (filter && !langName.includes(filter)) {
            continue;
        }

        console.log(`Processing ${langName}...`);

        try {
            // Apply vendor patch if one exists (e.g. vendor/patches/tree-sitter-masm.patch)
            let patched = false;
            const patchFile = path.join(PATCHES_DIR, `${vendorName}.patch`);
            if (fs.existsSync(patchFile)) {
                console.log(`  Applying patch ${vendorName}.patch...`);
                execSync(`git apply "${patchFile}"`, {
                    cwd: vendorPath,
                    stdio: ['ignore', 'inherit', 'inherit']
                });
                patched = true;
            }

            // CHECK: Does src/parser.c exist?
            // If missing, we generate it (fixes 'tolk').
            // If patched, we must regenerate since the grammar changed.
            // If present and unpatched, we skip 'generate' to avoid 'emcc' errors (fixes 'javascript').
            const parserCPath = path.join(target.path, 'src', 'parser.c');

            if (!fs.existsSync(parserCPath) || patched) {
                console.log(`  ${patched ? 'Patch applied.' : '! src/parser.c missing.'} Running 'generate'...`);
                execSync(`"${TREE_SITTER_CLI}" generate`, {
                    cwd: target.path,
                    stdio: ['ignore', 'inherit', 'inherit']
                });
            }

            console.log(`  Building WASM...`);
            execSync(`"${TREE_SITTER_CLI}" build --wasm`, {
                cwd: target.path,
                stdio: ['ignore', 'inherit', 'inherit']
            });

            // Find output file (it is usually named tree-sitter-<lang>.wasm or just <lang>.wasm)
            const files = fs.readdirSync(target.path);
            const wasmFile = files.find(f => f.endsWith('.wasm'));

            if (wasmFile) {
                const sourcePath = path.join(target.path, wasmFile);
                const destPath = path.join(PARSERS_DIR, `${langName}.wasm`);
                fs.renameSync(sourcePath, destPath);
                console.log(`  ✓ Success: ${destPath}`);
            } else {
                console.error(`  ✗ Error: No .wasm file produced for ${langName}`);
            }

        } catch (error) {
            console.error(`  ✗ Failed to build ${langName}`);
        } finally {
            // Revert any applied patches so the submodule stays pristine
            if (fs.existsSync(path.join(PATCHES_DIR, `${vendorName}.patch`))) {
                execSync('git checkout -- .', { cwd: vendorPath, stdio: 'ignore' });
            }
        }
    }
}

console.log('Build complete.');