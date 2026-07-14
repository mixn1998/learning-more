import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerPlanningRoutes } from './planning.js';

const headers = {
  host: '127.0.0.1:43120',
  origin: 'http://127.0.0.1:5173',
  'x-csrf-token': 'csrf',
  'x-page-instance-id': 'page_01',
  'idempotency-key': 'idem_01',
};

function fixture() {
  const execute = vi.fn().mockResolvedValue({
    scheduleItem: { id: 'schedule_01', resourceVersion: 1 },
  });
  const requestPreview = vi.fn().mockResolvedValue({ id: 'plan_flow_01', resourceVersion: 1 });
  const confirm = vi.fn().mockResolvedValue({ id: 'plan_flow_01', resourceVersion: 3 });
  const get = vi.fn().mockResolvedValue({
    id: 'plan_flow_01',
    state: 'confirmed',
    lifecycleState: 'active',
    resourceVersion: 3,
  });
  const manage = vi.fn().mockResolvedValue({
    id: 'plan_flow_01',
    state: 'confirmed',
    lifecycleState: 'paused',
    resourceVersion: 4,
  });
  const app = Fastify();
  void registerPlanningRoutes(app, {
    planning: { execute, list: vi.fn().mockResolvedValue([]) },
    planFlows: { requestPreview, confirm, get, manage },
    nextCommandId: () => 'command_01',
    nextCorrelationId: () => 'correlation_01',
    now: () => new Date('2026-07-13T00:00:00.000Z'),
  });
  return { app, execute, requestPreview, confirm, get, manage };
}

describe('Planning HTTP routes', () => {
  it('creates manual schedule assignments and rejects invalid intervals', async () => {
    const { app, execute } = fixture();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule-assignments',
      headers,
      payload: {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: 'bad',
        endAt: '2026-07-13T02:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
      },
    });
    expect(invalid.statusCode).toBe(400);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule-assignments',
      headers,
      payload: {
        courseId: 'course_01',
        lessonId: 'lesson_01',
        startAt: '2026-07-13T01:00:00.000Z',
        endAt: '2026-07-13T02:00:00.000Z',
        timezoneAtCreation: 'Asia/Shanghai',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/v1/schedule-assignments/schedule_01');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CreateScheduleItem', source: 'manual' }),
      expect.objectContaining({ commandId: 'command_01', pageInstanceId: 'page_01' }),
    );
  });

  it('previews and confirms a plan flow with If-Match protection', async () => {
    const { app, requestPreview, confirm } = fixture();
    const preview = await app.inject({
      method: 'POST',
      url: '/api/v1/plan-flow-previews',
      headers,
      payload: {
        constraintsArtifactRef: 'constraints_01',
        courseRefs: ['course_01'],
        lessonRefs: ['lesson_01'],
        timeWindowRefs: ['window_01'],
        existingScheduleSnapshotRef: 'snapshot_0',
      },
    });
    expect(preview.statusCode).toBe(202);
    expect(requestPreview).toHaveBeenCalledTimes(1);

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/plan-flows',
      headers: { ...headers, 'if-match': '"2"' },
      payload: { planFlowId: 'plan_flow_01' },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(confirm).toHaveBeenCalledWith(
      'plan_flow_01',
      expect.objectContaining({ expectedVersion: 2 }),
    );
  });

  it('moves, locks, and removes schedule assignments with If-Match protection', async () => {
    const { app, execute } = fixture();
    const moved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/schedule-assignments/schedule_01',
      headers: { ...headers, 'if-match': '"1"' },
      payload: {
        action: 'move',
        startAt: '2026-07-14T01:00:00.000Z',
        endAt: '2026-07-14T02:00:00.000Z',
      },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MoveScheduleItem', scheduleItemId: 'schedule_01' }),
      expect.objectContaining({ expectedVersion: 1 }),
    );

    const locked = await app.inject({
      method: 'PATCH',
      url: '/api/v1/schedule-assignments/schedule_01',
      headers: { ...headers, 'if-match': '"1"' },
      payload: { action: 'set-lock', locked: true },
    });
    expect(locked.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SetScheduleLock', locked: true }),
      expect.any(Object),
    );

    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/schedule-assignments/schedule_01',
      headers: { ...headers, 'if-match': '"1"' },
    });
    expect(removed.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RemoveScheduleItem' }),
      expect.any(Object),
    );
  });

  it('reads and manages a confirmed plan flow', async () => {
    const { app, get, manage } = fixture();
    const read = await app.inject({
      method: 'GET',
      url: '/api/v1/plan-flows/plan_flow_01',
      headers: { host: headers.host },
    });
    expect(read.statusCode).toBe(200);
    expect(get).toHaveBeenCalledWith('plan_flow_01');

    const action = await app.inject({
      method: 'POST',
      url: '/api/v1/plan-flows/plan_flow_01/actions',
      headers: { ...headers, 'if-match': '"3"' },
      payload: { action: 'pause' },
    });
    expect(action.statusCode, action.body).toBe(200);
    expect(manage).toHaveBeenCalledWith(
      'plan_flow_01',
      'pause',
      expect.objectContaining({ expectedVersion: 3 }),
    );
  });
});
