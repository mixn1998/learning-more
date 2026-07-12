import { readFile } from 'node:fs/promises';

const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const required = ['build', 'typecheck', 'lint', 'test', 'verify'];
const missing = required.filter((name) => typeof root.scripts?.[name] !== 'string');

if (missing.length > 0) {
  throw new Error('Missing root scripts: ' + missing.join(', '));
}
