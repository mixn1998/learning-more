import { duration, enforceBudget, medianOfFive, percentile } from './benchmark.js';

type SyntheticEvent = Readonly<{
  courseId: string;
  sessionId: string;
  durationSeconds: number;
}>;

function dataset(): readonly SyntheticEvent[] {
  return Array.from({ length: 100_000 }, (_, index) => ({
    courseId: `course_${index % 100}`,
    sessionId: `session_${index % 10_000}`,
    durationSeconds: 30 + (index % 600),
  }));
}

export async function benchmarkQueryLatency(): Promise<
  Readonly<{
    strongQueryP95Ms: number;
    nonAiWriteP95Ms: number;
  }>
> {
  const events = dataset();
  const strongQueryP95Ms = await medianOfFive(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      samples.push(
        await duration(() => {
          const courseId = `course_${index}`;
          const seconds = events
            .filter((event) => event.courseId === courseId)
            .reduce((sum, event) => sum + event.durationSeconds, 0);
          if (seconds <= 0) throw new Error('benchmark_query_invalid');
        }),
      );
    }
    return percentile(samples, 0.95);
  });
  const writes: SyntheticEvent[] = [];
  const nonAiWriteP95Ms = await medianOfFive(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      samples.push(
        await duration(() => {
          writes.push({
            courseId: 'course_write',
            sessionId: `write_${index}`,
            durationSeconds: 1,
          });
        }),
      );
    }
    return percentile(samples, 0.95);
  });
  enforceBudget('strong_query_p95', strongQueryP95Ms, 200);
  enforceBudget('non_ai_write_p95', nonAiWriteP95Ms, 350);
  return { strongQueryP95Ms, nonAiWriteP95Ms };
}
