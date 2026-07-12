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
      createSchedule,
      requestPreview,
      confirmPlanFlow,
    };
    render(<PlanningPage client={api} />);
    const courses = await screen.findByLabelText('计划课程 ID');
    const lessons = screen.getByLabelText('计划课节 ID');
    fireEvent.change(courses, { target: { value: 'course_01' } });
    fireEvent.change(lessons, { target: { value: 'lesson_01' } });
    fireEvent.click(screen.getByRole('button', { name: '生成计划预览' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('schedule_existing');
    expect(createSchedule).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认计划流' }));
    await waitFor(() => expect(confirmPlanFlow).toHaveBeenCalledWith('plan_flow_01', 2));
    expect(await screen.findByText('排期版本已变化，请重新预览')).toBeInTheDocument();
    expect(courses).toHaveValue('course_01');
    expect(lessons).toHaveValue('lesson_01');
  });
});
