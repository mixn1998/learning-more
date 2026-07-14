import { useMemo, useState } from 'react';

import type { HomeDashboardView } from '@learning-more/contracts';
import { Badge, Button, ContentState, Inline, SectionHeader, Stack } from '@learning-more/ui';

import type { ScheduleItemView } from '../../client/planning-client.js';
import { PlanningDateFilter, type PlanningDateItem } from './planning-date-filter.js';

type ScheduleDraft = Readonly<{ startAt: string; endAt: string }>;
type LessonCandidate = HomeDashboardView['lessons'][number];
type BoardEntry = PlanningDateItem &
  Readonly<{
    courseId: string;
    title: string;
    schedule?: ScheduleItemView;
  }>;

function localInputValue(instant: string): string {
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function utcInstant(local: string): string {
  return new Date(local).toISOString();
}

export function ScheduleBoard(props: {
  readonly items: readonly ScheduleItemView[];
  readonly lessons?: readonly LessonCandidate[];
  readonly onCreate: (input: {
    courseId: string;
    lessonId: string;
    startAt: string;
    endAt: string;
    timezoneAtCreation: string;
  }) => Promise<void>;
  readonly onMove: (item: ScheduleItemView, draft: ScheduleDraft) => Promise<void>;
  readonly onSetLock: (item: ScheduleItemView, locked: boolean) => Promise<void>;
  readonly onRemove: (item: ScheduleItemView) => Promise<void>;
}) {
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ScheduleDraft>>({});
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const activeItems = props.items.filter((item) => item.status === 'scheduled');
  const entries = useMemo<readonly BoardEntry[]>(() => {
    const scheduleByLesson = new Map(activeItems.map((item) => [item.lessonId, item]));
    const result: BoardEntry[] = (props.lessons ?? []).map((lesson) => {
      const schedule = scheduleByLesson.get(lesson.lessonId);
      if (schedule !== undefined) scheduleByLesson.delete(lesson.lessonId);
      return {
        lessonId: lesson.lessonId,
        courseId: lesson.courseId,
        title: lesson.title,
        progress: lesson.progress,
        ...(schedule === undefined
          ? {}
          : {
              schedule,
              plannedLocalDate: localInputValue(schedule.startAt).slice(0, 10),
            }),
      };
    });
    for (const schedule of scheduleByLesson.values()) {
      result.push({
        lessonId: schedule.lessonId,
        courseId: schedule.courseId,
        title: schedule.lessonId,
        schedule,
        plannedLocalDate: localInputValue(schedule.startAt).slice(0, 10),
      });
    }
    return result;
  }, [activeItems, props.lessons]);

  async function run(item: ScheduleItemView, action: () => Promise<void>) {
    setBusyId(item.id);
    setError(undefined);
    try {
      await action();
    } catch {
      setError('排期版本已变化或操作未完成，请刷新后重试。');
    } finally {
      setBusyId(undefined);
    }
  }

  function selectPending(entry: BoardEntry) {
    setCourseId(entry.courseId);
    setLessonId(entry.lessonId);
    setError(undefined);
  }

  return (
    <section className="authoring-panel planning-board">
      <SectionHeader
        title="正式排期"
        description="所有调整均经过版本校验；锁定后的课节不会被自动重排。"
      />
      <form
        id="manual-schedule-form"
        className="manual-schedule-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          setBusyId('create');
          void props
            .onCreate({
              courseId,
              lessonId,
              startAt: utcInstant(startAt),
              endAt: utcInstant(endAt),
              timezoneAtCreation: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })
            .then(
              () => {
                setLessonId('');
                setStartAt('');
                setEndAt('');
              },
              () => setError('创建排期失败，请检查时间区间与课节状态。'),
            )
            .finally(() => setBusyId(undefined));
        }}
      >
        <label className="lm-field">
          <span>课程 ID</span>
          <input required value={courseId} onChange={(event) => setCourseId(event.target.value)} />
        </label>
        <label className="lm-field">
          <span>课节 ID</span>
          <input required value={lessonId} onChange={(event) => setLessonId(event.target.value)} />
        </label>
        <label className="lm-field">
          <span>开始时间</span>
          <input
            required
            type="datetime-local"
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
          />
        </label>
        <label className="lm-field">
          <span>结束时间</span>
          <input
            required
            type="datetime-local"
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
          />
        </label>
        <Button busy={busyId === 'create'} type="submit" variant="primary">
          创建手工排期
        </Button>
      </form>

      {error === undefined ? null : <ContentState title={error} role="alert" />}
      <PlanningDateFilter items={entries}>
        {(visible) =>
          visible.length === 0 ? (
            <ContentState title="当前筛选暂无课节" description="可切换其他日期或待规划视图。" />
          ) : (
            <Stack className="schedule-list">
              {visible.map((entry) => {
                const item = entry.schedule;
                if (item === undefined) {
                  return (
                    <article className="schedule-item schedule-item--pending" key={entry.lessonId}>
                      <header>
                        <div>
                          <strong>{entry.title}</strong>
                          <small>{entry.courseId}</small>
                        </div>
                        <Badge tone="warning">待规划</Badge>
                      </header>
                      <Button type="button" onClick={() => selectPending(entry)}>
                        填写排期
                      </Button>
                    </article>
                  );
                }
                const draft = drafts[item.id] ?? {
                  startAt: localInputValue(item.startAt),
                  endAt: localInputValue(item.endAt),
                };
                const busy = busyId === item.id;
                return (
                  <article className="schedule-item" key={item.id}>
                    <header>
                      <div>
                        <strong>{entry.title}</strong>
                        <small>
                          {entry.courseId} · {entry.lessonId}
                        </small>
                      </div>
                      <Inline>
                        <Badge tone={item.locked === true ? 'readonly' : 'neutral'}>
                          {item.locked === true ? '已锁定' : '可重排'}
                        </Badge>
                        <Badge>{item.source === 'plan-flow' ? '计划流' : '手工'}</Badge>
                      </Inline>
                    </header>
                    <div className="schedule-item__times">
                      <label className="lm-field">
                        <span>开始</span>
                        <input
                          aria-label={`${item.lessonId} 开始时间`}
                          disabled={item.locked === true || busy}
                          type="datetime-local"
                          value={draft.startAt}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [item.id]: { ...draft, startAt: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label className="lm-field">
                        <span>结束</span>
                        <input
                          aria-label={`${item.lessonId} 结束时间`}
                          disabled={item.locked === true || busy}
                          type="datetime-local"
                          value={draft.endAt}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [item.id]: { ...draft, endAt: event.target.value },
                            }))
                          }
                        />
                      </label>
                    </div>
                    <Inline className="schedule-item__actions">
                      <Button
                        busy={busy}
                        disabled={item.locked === true}
                        onClick={() =>
                          void run(item, () =>
                            props.onMove(item, {
                              startAt: utcInstant(draft.startAt),
                              endAt: utcInstant(draft.endAt),
                            }),
                          )
                        }
                        type="button"
                      >
                        保存时间与时长
                      </Button>
                      <Button
                        busy={busy}
                        onClick={() =>
                          void run(item, () => props.onSetLock(item, item.locked !== true))
                        }
                        type="button"
                      >
                        {item.locked === true ? '解除锁定' : '锁定课节'}
                      </Button>
                      <Button
                        busy={busy}
                        onClick={() => void run(item, () => props.onRemove(item))}
                        type="button"
                        variant="danger"
                      >
                        取消排期
                      </Button>
                    </Inline>
                  </article>
                );
              })}
            </Stack>
          )
        }
      </PlanningDateFilter>
    </section>
  );
}
