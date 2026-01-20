import { readFileSync, writeFileSync } from 'fs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

const files = ['gemini-extension.json', '.claude-plugin/plugin.json'];

for (const file of files) {
  const content = JSON.parse(readFileSync(file, 'utf8'));
  content.version = version;
  writeFileSync(file, JSON.stringify(content, null, 2) + '\n');
}

console.log(`Synced version ${version} to ${files.join(', ')}`);
