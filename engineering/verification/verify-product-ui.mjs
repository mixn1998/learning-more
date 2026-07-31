import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const webRoot = path.resolve(projectRoot, process.argv[2] ?? 'apps/web/dist');
const sourceRoot = path.resolve(projectRoot, 'apps/web/src');

async function files(root, predicate, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(root, predicate, absolute)));
    else if (predicate(absolute)) output.push(absolute);
  }
  return output;
}

function fail(issues) {
  process.stderr.write(`${JSON.stringify({ ok: false, webRoot, issues }, null, 2)}\n`);
  process.exitCode = 1;
}

const issues = [];
let index = '';
try {
  index = await readFile(path.join(webRoot, 'index.html'), 'utf8');
} catch {
  fail(['product_ui_build_missing']);
  process.exit();
}

if (!index.includes('<div id="root"></div>')) issues.push('react_root_missing');
if (index.includes('sample-ui.js') || index.includes('UI视觉预览')) {
  issues.push('sample_ui_entry_detected');
}

const scripts = await files(webRoot, (file) => file.endsWith('.js'));
const javascript = (await Promise.all(scripts.map((file) => readFile(file, 'utf8')))).join('\n');
for (const marker of ['/api/v1/home', '/api/v1/schedule', '/api/v1/ai-runtime/status']) {
  if (!javascript.includes(marker)) issues.push(`real_api_marker_missing:${marker}`);
}
for (const marker of ['sample-ui.js', 'UI视觉预览', 'data-demo-mode']) {
  if (javascript.includes(marker)) issues.push(`sample_marker_detected:${marker}`);
}

const sourceFiles = await files(sourceRoot, (file) => /\.(?:ts|tsx|css)$/.test(file));
const [indexStat, ...sourceStats] = await Promise.all([
  stat(path.join(webRoot, 'index.html')),
  ...sourceFiles.map((file) => stat(file)),
]);
const newestSource = Math.max(...sourceStats.map((value) => value.mtimeMs));
if (indexStat.mtimeMs < newestSource) issues.push('product_ui_build_stale');

if (issues.length > 0) fail(issues);
else {
  process.stdout.write(
    `${JSON.stringify({ ok: true, webRoot, scriptCount: scripts.length, mode: 'real-react-api' })}\n`,
  );
}
