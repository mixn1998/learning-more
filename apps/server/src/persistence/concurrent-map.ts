export async function mapConcurrentOrdered<T, TResult>(
  values: readonly T[],
  operation: (value: T, index: number) => Promise<TResult>,
  concurrency = 32,
): Promise<TResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('CONCURRENCY_INVALID');
  }
  if (values.length === 0) return [];
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await operation(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
