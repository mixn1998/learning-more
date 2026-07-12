export type ScheduleItemView = Readonly<{
  id: string;
  courseId: string;
  lessonId: string;
  startAt: string;
  endAt: string;
  timezoneAtCreation: string;
  source: 'manual' | 'plan-flow';
  resourceVersion: number;
}>;

export type PlanFlowPreviewView = Readonly<{
  id: string;
  state: string;
  resourceVersion: number;
  suggestions: readonly Readonly<{
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    explanation: string;
  }>[];
  conflicts: readonly string[];
}>;

export interface PlanningClient {
  getSchedule(): Promise<{ items: readonly ScheduleItemView[]; resourceVersion: number }>;
  createSchedule(input: Omit<ScheduleItemView, 'id' | 'source' | 'resourceVersion'>): Promise<{
    scheduleItem: ScheduleItemView;
  }>;
  requestPreview(input: {
    constraintsArtifactRef: string;
    courseRefs: readonly string[];
    lessonRefs: readonly string[];
    timeWindowRefs: readonly string[];
    existingScheduleSnapshotRef: string;
  }): Promise<PlanFlowPreviewView>;
  confirmPlanFlow(planFlowId: string, resourceVersion: number): Promise<PlanFlowPreviewView>;
}

function pageInstanceId(): string {
  const key = 'learning-more.page-instance-id';
  const existing = sessionStorage.getItem(key);
  if (existing !== null) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

function headers(version?: number): HeadersInit {
  return {
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    'x-csrf-token': 'development-csrf',
    'x-page-instance-id': pageInstanceId(),
    ...(version === undefined ? {} : { 'if-match': `"${version}"` }),
  };
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) throw body;
  return body;
}

export const planningClient: PlanningClient = {
  async getSchedule() {
    return json(await fetch('/api/v1/schedule'));
  },
  async createSchedule(input) {
    return json(
      await fetch('/api/v1/schedule-assignments', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(input),
      }),
    );
  },
  async requestPreview(input) {
    return json(
      await fetch('/api/v1/plan-flow-previews', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(input),
      }),
    );
  },
  async confirmPlanFlow(planFlowId, resourceVersion) {
    return json(
      await fetch('/api/v1/plan-flows', {
        method: 'POST',
        headers: headers(resourceVersion),
        body: JSON.stringify({ planFlowId }),
      }),
    );
  },
};
