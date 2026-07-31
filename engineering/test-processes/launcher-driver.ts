import { createInterface } from 'node:readline';

import { runLauncher } from '../../apps/launcher/src/main.js';

const launcher = await runLauncher();
process.stdout.write('READY\n');
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line === 'crash') process.exit(91);
  if (line === 'close') {
    input.close();
    void launcher.close().then(() => process.exit(0));
  }
});
