import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  close,
  createUiSampleServer,
  listen,
  samplePort,
  uiRoot,
} from './sample-server.mjs';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAudits = [
  'run-ui-audit.mjs',
  'run-page-smoke.mjs',
  'report-instructional-copy.mjs',
  'run-control-wiring.mjs',
  'run-control-geometry.mjs',
  'run-module-geometry.mjs',
  'run-typography-spacing.mjs',
  'run-interaction-regression.mjs',
  'run-visual-integrity.mjs',
];
const requestedAudits = process.argv.slice(2);
const audits = requestedAudits.length === 0 ? defaultAudits : requestedAudits;
for (const audit of audits) {
  if (!defaultAudits.includes(audit)) throw new Error(`Unknown UI audit: ${audit}`);
}

const server = createUiSampleServer();

function runAudit(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(testsDir, file)], {
      cwd: uiRoot,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

try {
  await listen(server);
  console.log(`UI sample server ready at http://127.0.0.1:${samplePort}`);
  for (const audit of audits) {
    console.log(`\n> ${audit}`);
    await runAudit(audit);
  }
  console.log(`\nAll ${audits.length} UI sample audits passed.`);
} finally {
  await close(server);
}
