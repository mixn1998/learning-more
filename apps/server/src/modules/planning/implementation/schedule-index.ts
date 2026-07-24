import type { ScheduleItem } from '../model/schedule-item.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';

export type ScheduleIndexSnapshot = Readonly<{
  items: readonly ScheduleItem[];
  scheduled: readonly ScheduleItem[];
  resourceVersion: number;
  get(id: string): ScheduleItem | undefined;
  forLesson(lessonId: string): readonly ScheduleItem[];
  forCourse(courseId: string): readonly ScheduleItem[];
  forCommand(commandId: string): readonly ScheduleItem[];
}>;

export interface ScheduleIndex {
  current(): Promise<ScheduleIndexSnapshot>;
}

function append(index: Map<string, ScheduleItem[]>, key: string, item: ScheduleItem): void {
  const bucket = index.get(key);
  if (bucket === undefined) index.set(key, [item]);
  else bucket.push(item);
}

function snapshot(items: readonly ScheduleItem[]): ScheduleIndexSnapshot {
  const sorted = [...items].sort((left, right) =>
    left.startAt === right.startAt
      ? left.id.localeCompare(right.id)
      : left.startAt.localeCompare(right.startAt),
  );
  const byId = new Map<string, ScheduleItem>();
  const byLesson = new Map<string, ScheduleItem[]>();
  const byCourse = new Map<string, ScheduleItem[]>();
  const byCommand = new Map<string, ScheduleItem[]>();
  let resourceVersion = 0;
  for (const item of sorted) {
    byId.set(item.id, item);
    append(byLesson, item.lessonId, item);
    append(byCourse, item.courseId, item);
    for (const commandId of item.processedCommandIds) append(byCommand, commandId, item);
    resourceVersion += item.resourceVersion;
  }
  return {
    items: sorted,
    scheduled: sorted.filter((item) => item.status === 'scheduled'),
    resourceVersion,
    get: (id) => byId.get(id),
    forLesson: (lessonId) => byLesson.get(lessonId) ?? [],
    forCourse: (courseId) => byCourse.get(courseId) ?? [],
    forCommand: (commandId) => byCommand.get(commandId) ?? [],
  };
}

export function createScheduleIndex(options: {
  readonly repository: ScheduleRepository;
  readonly revision: () => string;
}): ScheduleIndex {
  let cached: Readonly<{ revision: string; snapshot: ScheduleIndexSnapshot }> | undefined;
  let inFlight: Readonly<{ revision: string; promise: Promise<ScheduleIndexSnapshot> }> | undefined;

  async function build(expectedRevision: string): Promise<ScheduleIndexSnapshot> {
    const items: ScheduleItem[] = [];
    for await (const item of options.repository.list()) items.push(item);
    const currentRevision = options.revision();
    if (currentRevision !== expectedRevision) return build(currentRevision);
    const value = snapshot(items);
    cached = { revision: expectedRevision, snapshot: value };
    return value;
  }

  return {
    current() {
      const revision = options.revision();
      if (cached?.revision === revision) return Promise.resolve(cached.snapshot);
      if (inFlight?.revision === revision) return inFlight.promise;
      const promise = build(revision).finally(() => {
        if (inFlight?.promise === promise) inFlight = undefined;
      });
      inFlight = { revision, promise };
      return promise;
    },
  };
}
