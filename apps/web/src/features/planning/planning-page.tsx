import { useCallback, useEffect, useState } from 'react';

import { ApplicationProblemSchema, type HomeDashboardView } from '@learning-more/contracts';
import { ContentState } from '@learning-more/ui';

import {
  planningClient,
  type PlanningClient,
  type ScheduleItemView,
} from '../../client/planning-client.js';
import {
  useCommandAttempts,
  type CommandAttemptRegistry,
} from '../../state/use-command-attempt.js';
import { PlanFlowPanel } from './plan-flow-panel.js';
import { PlanningWorkspaceView, type PlanningLessonMetadata } from './planning-workspace-view.js';

function today(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

type PlanFlowPreviewRequest = Parameters<PlanningClient['requestPreview']>[0];

export async function requestPlanFlowPreview(
  client: Pick<PlanningClient, 'requestPreview'>,
  request: PlanFlowPreviewRequest,
  commands: CommandAttemptRegistry,
  commandKey: string,
) {
  for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
    try {
      const preview = await client.requestPreview(request, commands.attemptFor(commandKey));
      commands.complete(commandKey);
      return preview;
    } catch (error) {
      const problem = ApplicationProblemSchema.safeParse(error);
      if (attemptIndex > 0 || !problem.success || !problem.data.retryable) throw error;
      commands.complete(commandKey);
    }
  }
  throw new Error('Plan-flow preview retry loop exited unexpectedly');
}

export function PlanningPage(props: {
  readonly client?: PlanningClient;
  readonly now?: Date;
  readonly metadata?: Readonly<Record<string, PlanningLessonMetadata>>;
  readonly onNavigate?: (path: string) => void;
}) {
  const api = props.client ?? planningClient;
  const [items, setItems] = useState<readonly ScheduleItemView[]>([]);
  const [version, setVersion] = useState(0);
  const [courses, setCourses] = useState<HomeDashboardView['courses']>([]);
  const [lessons, setLessons] = useState<HomeDashboardView['lessons']>([]);
  const [view, setView] = useState<'planner' | 'flow'>('planner');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [contextError, setContextError] = useState(false);
  const commands = useCommandAttempts();
  const anchorDate = today(props.now ?? new Date());

  const reload = useCallback(async () => {
    const [scheduleResult, contextResult] = await Promise.allSettled([
      api.getSchedule(),
      api.getPlanningContext(),
    ]);
    if (scheduleResult.status === 'fulfilled') {
      setItems(scheduleResult.value.items);
      setVersion(scheduleResult.value.resourceVersion);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
    if (contextResult.status === 'fulfilled') {
      setCourses(contextResult.value.courses);
      setLessons(contextResult.value.lessons);
      setContextError(false);
    } else {
      setContextError(true);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const planFlow = (
    <PlanFlowPanel
      courses={courses}
      initialStartDate={anchorDate}
      lessons={lessons}
      onClose={() => setView('planner')}
      onConfirm={async (flow) => {
        const key = `plan-flow-confirm:${flow.id}:${flow.resourceVersion}`;
        const confirmed = await api.confirmPlanFlow(
          flow.id,
          flow.resourceVersion,
          commands.attemptFor(key),
        );
        commands.complete(key);
        await reload();
        return confirmed;
      }}
      onManage={async (flow, action) => {
        const key = `plan-flow-${action}:${flow.id}:${flow.resourceVersion}`;
        const managed = await api.managePlanFlow(
          flow.id,
          flow.resourceVersion,
          action,
          commands.attemptFor(key),
        );
        commands.complete(key);
        await reload();
        return managed;
      }}
      onPreview={(input) => {
        const request = {
          constraintsArtifactRef: 'constraints_manual',
          courseRefs: input.courseIds,
          lessonRefs: input.lessonIds,
          timeWindowRefs: [
            `start:${input.startDate}`,
            `daily:${input.dailyTargetMinutes}`,
            `days:${input.learningDays.join(',')}`,
            `preserve:${input.preserveExistingDates}`,
            `overdue:${input.rescheduleOverdue}`,
            `strategy:${input.strategy}`,
          ],
          existingScheduleSnapshotRef: `schedule_${version}`,
        };
        const key = `plan-flow-preview:${JSON.stringify(request)}`;
        return requestPlanFlowPreview(api, request, commands, key);
      }}
    />
  );

  if (view === 'flow') return planFlow;

  return (
    <>
      {loading ? <ContentState title="正在读取正式排期…" /> : null}
      {loadError ? (
        <ContentState
          title="正式排期暂时不可用"
          description="请检查后端运行状态后重试。"
          role="alert"
        />
      ) : null}
      {contextError && !loadError ? (
        <ContentState title="待规划课节索引暂不可用" description="已保存排期仍可查看和管理。" />
      ) : null}
      <PlanningWorkspaceView
        anchorDate={anchorDate}
        courses={courses}
        items={items}
        lessons={lessons}
        {...(props.metadata === undefined ? {} : { metadata: props.metadata })}
        onCreate={async (input) => {
          const key = `schedule-create:${input.courseId}:${input.lessonId}:${input.startAt}:${input.endAt}`;
          const created = await api.createSchedule(input, commands.attemptFor(key));
          commands.complete(key);
          setItems((current) => [
            ...current.filter((item) => item.id !== created.scheduleItem.id),
            created.scheduleItem,
          ]);
          setVersion((current) => current + 1);
        }}
        onClear={async (scheduleItemIds) => {
          const key = `schedule-clear:${version}:${scheduleItemIds.join(',')}`;
          const cleared = await api.clearSchedule(
            scheduleItemIds,
            version,
            commands.attemptFor(key),
          );
          commands.complete(key);
          setItems(cleared.items);
          setVersion(cleared.resourceVersion);
        }}
        onGeneratePlanFlow={() => setView('flow')}
        onMove={async (item, draft) => {
          const moveKey = `schedule-move:${item.id}:${item.resourceVersion}:${draft.startAt}:${draft.endAt}`;
          const moved = await api.moveSchedule(
            item.id,
            item.resourceVersion,
            draft.startAt,
            draft.endAt,
            commands.attemptFor(moveKey),
          );
          commands.complete(moveKey);
          let authoritativeItem = moved.scheduleItem;
          let versionDelta = 1;
          if (authoritativeItem.locked !== true) {
            const lockKey = `schedule-lock:${moved.scheduleItem.id}:${moved.scheduleItem.resourceVersion}:true`;
            const locked = await api.setScheduleLock(
              moved.scheduleItem.id,
              moved.scheduleItem.resourceVersion,
              true,
              commands.attemptFor(lockKey),
            );
            commands.complete(lockKey);
            authoritativeItem = locked.scheduleItem;
            versionDelta += 1;
          }
          setItems((current) =>
            current.map((candidate) =>
              candidate.id === authoritativeItem.id ? authoritativeItem : candidate,
            ),
          );
          setVersion((current) => current + versionDelta);
        }}
        onRemove={async (item) => {
          const key = `schedule-remove:${item.id}:${item.resourceVersion}`;
          const removed = await api.removeSchedule(
            item.id,
            item.resourceVersion,
            commands.attemptFor(key),
          );
          commands.complete(key);
          setItems((current) =>
            current.filter((candidate) => candidate.id !== removed.scheduleItem.id),
          );
          setVersion((current) => current + 1);
        }}
        onReturn={() => {
          if (props.onNavigate !== undefined) props.onNavigate('/');
          else window.location.assign('/');
        }}
      />
    </>
  );
}
