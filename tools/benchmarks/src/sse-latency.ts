import { duration, enforceBudget, medianOfFive, percentile } from './benchmark.js';

export async function benchmarkSseLatency(): Promise<number> {
  const observed = await medianOfFive(async () => {
    const samples: number[] = [];
    for (let sequence = 1; sequence <= 1_000; sequence += 1) {
      samples.push(
        await duration(() => {
          const encoded = `id: task_benchmark:${sequence}\nevent: message.delta\ndata: ${JSON.stringify({ text: 'delta' })}\n\n`;
          const data = encoded
            .split('\n')
            .find((line) => line.startsWith('data: '))
            ?.slice(6);
          if (data === undefined || (JSON.parse(data) as { text?: unknown }).text !== 'delta') {
            throw new Error('benchmark_sse_invalid');
          }
        }),
      );
    }
    return percentile(samples, 0.95);
  });
  enforceBudget('provider_delta_to_sse_p95', observed, 100);
  return observed;
}
