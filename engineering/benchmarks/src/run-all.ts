import { benchmarkQueryLatency } from './query-latency.js';
import { benchmarkSseLatency } from './sse-latency.js';
import { benchmarkStartup } from './startup.js';

const result = {
  coldStartMedianMs: await benchmarkStartup(),
  ...(await benchmarkQueryLatency()),
  providerDeltaToSseP95Ms: await benchmarkSseLatency(),
};

process.stdout.write(`${JSON.stringify(result)}\n`);
