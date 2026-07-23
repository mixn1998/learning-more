import { createUiSampleServer, listen, samplePort } from './sample-server.mjs';

const server = createUiSampleServer();
await listen(server);
console.log(`UI sample server ready at http://127.0.0.1:${samplePort}`);

process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));
await new Promise(() => undefined);
