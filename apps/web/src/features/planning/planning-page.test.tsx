// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlanningClient } from '../../client/planning-client.js';
import { PlanningPage } from './planning-page.js';

afterEach(cleanup);

describe('PlanningPage', () => {
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
