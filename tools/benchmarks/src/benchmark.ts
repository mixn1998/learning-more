import { performance } from 'node:perf_hooks';

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error('benchmark_samples_empty');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

export async function duration(operation: () => Promise<void> | void): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

export async function medianOfFive(operation: () => Promise<number>): Promise<number> {
  const results: number[] = [];
  for (let run = 0; run < 5; run += 1) results.push(await operation());
  return percentile(results, 0.5);
}

export function enforceBudget(name: string, observedMs: number, budgetMs: number): void {
  if (observedMs > budgetMs) {
    throw new Error(
      `benchmark_budget_exceeded:${name}:observed=${observedMs.toFixed(2)}ms:budget=${budgetMs}ms`,
    );
  }
}
