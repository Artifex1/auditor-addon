#!/usr/bin/env node
/**
 * Copy ast-grep binaries from node_modules to dist/bin
 * This ensures the binaries are bundled with the extension distribution
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.join(__dirname, '..');
const distBinDir = path.join(projectRoot, 'dist', 'bin');

// Map of platform-arch to package name
const supportedPlatforms = {
    'darwin-arm64': '@ast-grep/cli-darwin-arm64',
    'darwin-x64': '@ast-grep/cli-darwin-x64',
    'linux-arm64': '@ast-grep/cli-linux-arm64-gnu',
    'linux-x64': '@ast-grep/cli-linux-x64-gnu',
    'win32-arm64': '@ast-grep/cli-win32-arm64-msvc',
    'win32-x64': '@ast-grep/cli-win32-x64-msvc',
};

// Create dist/bin directory
if (!fs.existsSync(distBinDir)) {
    fs.mkdirSync(distBinDir, { recursive: true });
}

console.log('Copying ast-grep binaries...');

let successCount = 0;

for (const [platformKey, packageName] of Object.entries(supportedPlatforms)) {
    const binaryName = platformKey.startsWith('win32') ? 'ast-grep.exe' : 'ast-grep';
    const destBinaryName = `ast-grep-${platformKey}${platformKey.startsWith('win32') ? '.exe' : ''}`;

    // Try to find the binary in node_modules
    // We look in the package's folder. 
    // Note: pnpm structure might be nested, but since we added them to devDependencies,
    // they should be resolvable or in a predictable location if hoisted.

    // Strategy: Use require.resolve to find the package's package.json, then find the binary relative to it?
    // Actually, ast-grep packages usually have the binary in the root or a bin folder.
    // Let's try to find it by path probing.

    let sourcePath = null;

    // 1. Try direct node_modules path (npm/yarn/pnpm hoisted)
    const directPath = path.join(projectRoot, 'node_modules', packageName, binaryName);

    // 2. Try pnpm nested path (if not hoisted)
    // This is harder to guess reliably without parsing lockfile or dir scanning.
    // But since we installed them, they should be in node_modules/.pnpm/...

    if (fs.existsSync(directPath)) {
        sourcePath = directPath;
    } else {
        // Try to find it in .pnpm
        const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm');
        if (fs.existsSync(pnpmDir)) {
            const entries = fs.readdirSync(pnpmDir);
            const pnpmName = packageName.replace('/', '+');
            const match = entries.find(e => e.startsWith(pnpmName + '@'));
            if (match) {
                sourcePath = path.join(pnpmDir, match, 'node_modules', packageName, binaryName);
            }
        }
    }

    if (sourcePath && fs.existsSync(sourcePath)) {
        const destPath = path.join(distBinDir, destBinaryName);
        try {
            fs.copyFileSync(sourcePath, destPath);
            if (!platformKey.startsWith('win32')) {
                fs.chmodSync(destPath, 0o755);
            }
            console.log(`✓ ${platformKey}: Copied to ${destBinaryName}`);
            successCount++;
        } catch (err) {
            console.error(`✗ ${platformKey}: Failed to copy - ${err.message}`);
        }
    } else {
        console.warn(`! ${platformKey}: Binary not found in node_modules. Skipping.`);
        // console.warn(`  Checked: ${directPath}`);
    }
}

if (successCount === 0) {
    console.error('No binaries were copied! Please check your installation.');
    process.exit(1);
}

console.log(`\nSuccessfully bundled ${successCount} binaries.`);
