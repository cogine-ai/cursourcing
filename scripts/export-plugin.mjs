import { cpSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) throw new Error('Usage: node scripts/export-plugin.mjs <destination>');
const destination = resolve(process.argv[2]);
if (destination === resolve(root)) throw new Error('Choose a separate distribution directory');
mkdirSync(destination, { recursive: true });
for (const relative of ['.codex-plugin', '.mcp.json', 'dist', 'skills', 'assets', 'docs', 'README.md', 'README.zh-CN.md']) {
  cpSync(join(root, relative), join(destination, relative), { recursive: true });
}
console.log(`Exported Cursourcing to ${destination}`);
