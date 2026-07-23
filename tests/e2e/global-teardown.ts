import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const processFile = path.join(process.cwd(), 'tests', '.tmp', 'e2e-processes.json');

export default async function globalTeardown() {
  let processes: { server: number; web: number } | undefined;
  try {
    processes = JSON.parse(await readFile(processFile, 'utf8')) as {
      server: number;
      web: number;
    };
  } catch {
    return;
  }
  for (const processId of [processes.web, processes.server]) {
    try {
      process.kill(processId, 'SIGTERM');
    } catch {
      // A child that already exited needs no cleanup.
    }
  }
  await rm(processFile, { force: true });
}
