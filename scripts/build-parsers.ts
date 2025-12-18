import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.join(__dirname, '..');
const GRAMMARS_DIR = path.join(ROOT_DIR, 'vendor', 'grammars');
const PARSERS_DIR = path.join(ROOT_DIR, 'dist', 'mcp', 'parsers');

const filter = process.argv[2];

// Languages to build. 
const languages = fs.readdirSync(GRAMMARS_DIR).filter(name => {
    const isTarget = fs.statSync(path.join(GRAMMARS_DIR, name)).isDirectory() && name.startsWith('tree-sitter-');
    if (!isTarget) return false;
    if (filter && !name.includes(filter)) return false;
    return true;
});

// Create parsers directory if it doesn't exist
if (!fs.existsSync(PARSERS_DIR)) {
    fs.mkdirSync(PARSERS_DIR, { recursive: true });
}

console.log(`Found ${languages.length} grammars to build.`);

for (const langDir of languages) {
    const langPath = path.join(GRAMMARS_DIR, langDir);
    const langName = langDir.replace('tree-sitter-', '');
    // const wasmFile = `tree-sitter-${langName}.wasm`; // This is no longer needed here as it's dynamically found
    // const targetPath = path.join(PARSERS_DIR, wasmFile); // This is redefined inside the try block

    console.log(`Building ${langName}...`);

    try {
        // Generate parser if needed
        console.log(`  Generating parser...`);
        execSync(`npx tree-sitter generate`, {
            cwd: langPath,
            stdio: 'inherit'
        });

        console.log(`  Building WASM...`);
        execSync(`npx tree-sitter build --wasm`, {
            cwd: langPath,
            stdio: 'inherit'
        });

        // Scan for any .wasm file in the directory
        const files = fs.readdirSync(langPath);
        const wasmFiles = files.filter(f => f.endsWith('.wasm'));

        if (wasmFiles.length > 0) {
            // If multiple, try to find the one that matches our expectations or just the first one
            const sourceFile = wasmFiles.find(f => f.includes(langName)) || wasmFiles[0];
            const sourcePath = path.join(langPath, sourceFile);

            // We want to keep our naming convention in lib/parsers: tree-sitter-<lang>.wasm
            // Using the directory name as the base for consistency.
            const targetPath = path.join(PARSERS_DIR, `${langDir}.wasm`);

            fs.renameSync(sourcePath, targetPath);
            console.log(`  ✓ Successfully built and moved ${sourceFile} to ${targetPath}`);
        } else {
            console.error(`  ✗ Error: No .wasm file found in ${langPath} after build.`);
        }
    } catch (error) {
        console.error(`  ✗ Error building ${langName}:`, error);
    }
}

console.log('Build complete.');
