// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanningClient } from '../../client/planning-client.js';
import { createCommandAttemptRegistry } from '../../state/use-command-attempt.js';
import { PlanningPage, requestPlanFlowPreview } from './planning-page.js';

afterEach(cleanup);

describe('PlanningPage', () => {
  it('removes a cancelled schedule from the visible page without a manual reload', async () => {
    const scheduledItem = {
      id: 'schedule_cancel_01',
      courseId: 'course_01',
      lessonId: 'lesson_cancel_01',
      startAt: '2026-07-16T11:00:00.000Z',
      endAt: '2026-07-16T11:45:00.000Z',
      timezoneAtCreation: 'Asia/Shanghai',
      source: 'manual' as const,
      status: 'scheduled' as const,
      locked: false,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      processedCommandIds: [],
      resourceVersion: 1,
    };
    const removeSchedule = vi.fn().mockResolvedValue({ scheduleItem: scheduledItem });
    const api: PlanningClient = {
      getSchedule: vi.fn().mockResolvedValue({ items: [scheduledItem], resourceVersion: 1 }),
      getPlanningContext: vi.fn().mockResolvedValue({
        courses: [
          {
            courseId: 'course_01',
            title: '计划测试课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_01',
            resourceVersion: 1,
          },
        ],
        lessons: [
          {
            courseId: 'course_01',
            lessonId: 'lesson_cancel_01',
            title: '取消后立即刷新课节',
            progress: 'not_started',
            recommended: false,
          },
        ],
      }),
      clearSchedule: vi.fn(),
      createSchedule: vi.fn(),
      moveSchedule: vi.fn(),
      resizeSchedule: vi.fn(),
      setScheduleLock: vi.fn(),
      removeSchedule,
      requestPreview: vi.fn(),
      confirmPlanFlow: vi.fn(),
      getPlanFlow: vi.fn(),
      managePlanFlow: vi.fn(),
    };
    render(<PlanningPage client={api} now={new Date('2026-07-15T04:00:00.000Z')} />);
    await screen.findByRole('heading', { name: '安排课节学习日期' });

    fireEvent.click(screen.getByRole('button', { name: '取消排期' }));

    await waitFor(() => expect(removeSchedule).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByLabelText('安排学习日期：取消后立即刷新课节')).toHaveValue(''),
    );
    expect(screen.queryByRole('button', { name: '取消排期' })).not.toBeInTheDocument();
  });

  it('retries one retryable preview failure with a fresh command attempt', async () => {
    const preview = {
      id: 'plan_flow_retry',
      state: 'preview-ready' as const,
      resourceVersion: 1,
      suggestions: [],
      conflicts: [],
    };
    const requestPreview = vi
      .fn()
      .mockRejectedValueOnce({
        type: 'https://learning-more.local/problems/generation-timeout',
        status: 503,
        code: 'internal_error',
        messageKey: 'errors.internalError',
        retryable: true,
        correlationId: 'corr_retry_01',
      })
      .mockResolvedValueOnce(preview);
    let sequence = 0;
    const commands = createCommandAttemptRegistry(() => ({
      pageInstanceId: 'page_01',
      idempotencyKey: `idem_${++sequence}`,
    }));
    const request = {
      constraintsArtifactRef: 'constraints_manual',
      courseRefs: ['course_01'],
      lessonRefs: ['lesson_01'],
      timeWindowRefs: ['start:2026-07-15'],
      existingScheduleSnapshotRef: 'schedule_0',
    };

    await expect(
      requestPlanFlowPreview({ requestPreview }, request, commands, 'plan-flow-preview:test'),
    ).resolves.toEqual(preview);
    expect(requestPreview).toHaveBeenCalledTimes(2);
    expect(requestPreview.mock.calls[0]?.[1].idempotencyKey).toBe('idem_1');
    expect(requestPreview.mock.calls[1]?.[1].idempotencyKey).toBe('idem_2');
  });

  it('keeps preview constraints on conflict and writes nothing before confirm', async () => {
    const createSchedule = vi.fn();
    const requestPreview = vi.fn().mockResolvedValue({
      id: 'plan_flow_01',
      state: 'preview-ready',
      resourceVersion: 2,
      suggestions: [
        {
          courseId: 'course_01',
          lessonId: 'lesson_01',
          startAt: '2026-07-20T11:00:00.000Z',
          endAt: '2026-07-20T12:00:00.000Z',
          explanation: 'evening',
        },
      ],
      conflicts: ['schedule_existing'],
    });
    const confirmPlanFlow = vi.fn().mockRejectedValue({ code: 'version_conflict' });
    const api: PlanningClient = {
      getSchedule: vi.fn().mockResolvedValue({ items: [], resourceVersion: 0 }),
      getPlanningContext: vi.fn().mockResolvedValue({
        courses: [
          {
            courseId: 'course_01',
            title: '计划测试课程',
            status: 'active',
            courseMode: 'standard',
            outlineVersionId: 'outline_01',
            resourceVersion: 1,
          },
        ],
        lessons: [
          {
            courseId: 'course_01',
            lessonId: 'lesson_01',
            title: '计划测试课节',
            progress: 'not_started',
            recommended: true,
          },
        ],
      }),
      clearSchedule: vi.fn(),
      createSchedule,
      moveSchedule: vi.fn(),
      resizeSchedule: vi.fn(),
      setScheduleLock: vi.fn(),
      removeSchedule: vi.fn(),
      requestPreview,
      confirmPlanFlow,
      getPlanFlow: vi.fn(),
      managePlanFlow: vi.fn(),
    };
    render(<PlanningPage client={api} />);
    await screen.findByRole('heading', { name: '安排课节学习日期' });
    fireEvent.click(screen.getByRole('button', { name: '生成计划流' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByRole('button', { name: /计划测试课程/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('schedule_existing');
    expect(requestPreview).toHaveBeenCalledWith(
      expect.objectContaining({ courseRefs: ['course_01'], lessonRefs: ['lesson_01'] }),
      expect.any(Object),
    );
    expect(createSchedule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认计划流' }));
    await waitFor(() =>
      expect(confirmPlanFlow).toHaveBeenCalledWith('plan_flow_01', 2, expect.any(Object)),
    );
    expect(await screen.findByText('排期版本已变化，请重新预览。')).toBeInTheDocument();
    expect(screen.getByText('计划测试课节')).toBeInTheDocument();
  });
});
