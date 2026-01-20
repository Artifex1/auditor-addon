import { readFileSync, writeFileSync } from 'fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

// Files with version at root level
const rootVersionFiles = ['gemini-extension.json', '.claude-plugin/plugin.json'];

for (const file of rootVersionFiles) {
  const content = JSON.parse(readFileSync(file, 'utf8'));
  content.version = version;
  writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
}

// Marketplace file has version nested in plugins[0].version
const marketplaceFile = '.claude-plugin/marketplace.json';
const marketplace = JSON.parse(readFileSync(marketplaceFile, 'utf8'));
marketplace.plugins[0].version = version;
writeFileSync(marketplaceFile, JSON.stringify(marketplace, null, 2) + '\n');

const allFiles = [...rootVersionFiles, marketplaceFile];
console.log(`Synced version ${version} to ${allFiles.join(', ')}`);
