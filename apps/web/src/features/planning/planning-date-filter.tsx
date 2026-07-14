import { useMemo, useState, type ReactNode } from 'react';

import { Badge, Button, ContentState, Panel, SectionHeader } from '@learning-more/ui';

export type PlanningDateItem = Readonly<{
  lessonId: string;
  plannedLocalDate?: string;
  progress?: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
}>;

function localDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function sevenDates(anchor: string): readonly string[] {
  const start = new Date(`${anchor}T12:00:00`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDate(date);
  });
}

export function PlanningDateFilter<T extends PlanningDateItem>(props: {
  readonly items: readonly T[];
  readonly anchorDate?: string;
  readonly children?: (visible: readonly T[]) => ReactNode;
}) {
  const candidates = useMemo(
    () =>
      props.items.filter((item) => item.progress !== 'abandoned' && item.progress !== 'completed'),
    [props.items],
  );
  const anchor = props.anchorDate ?? localDate(new Date());
  const dates = useMemo(() => {
    const window = sevenDates(anchor);
    const scheduled = candidates.flatMap((item) => item.plannedLocalDate ?? []);
    return [...new Set([...window, ...scheduled])].sort();
  }, [anchor, candidates]);
  const [selection, setSelection] = useState<string>(anchor);
  const visible = candidates.filter((item) =>
    selection === 'pending'
      ? item.plannedLocalDate === undefined
      : item.plannedLocalDate === selection,
  );
  const pendingCount = candidates.filter((item) => item.plannedLocalDate === undefined).length;

  return (
    <Panel className="planning-date-filter" aria-label="周历联动筛选">
      <SectionHeader
        title="今日起 7 天"
        description="日期与待规划为互斥视图，已完成或已放弃课节不会进入候选。"
        actions={
          <Badge tone={pendingCount > 0 ? 'warning' : 'success'}>待规划 {pendingCount}</Badge>
        }
      />
      <nav aria-label="计划日期" className="planning-day-strip">
        {dates.slice(0, 7).map((date, index) => (
          <Button
            aria-label={date}
            aria-pressed={selection === date}
            data-selected={selection === date}
            key={date}
            type="button"
            variant={selection === date ? 'primary' : 'ghost'}
            onClick={() => setSelection(date)}
          >
            <small>{index === 0 ? '今天' : `第 ${index + 1} 天`}</small>
            <time dateTime={date}>{date}</time>
          </Button>
        ))}
        <Button
          aria-pressed={selection === 'pending'}
          data-selected={selection === 'pending'}
          type="button"
          variant={selection === 'pending' ? 'primary' : 'ghost'}
          onClick={() => setSelection('pending')}
        >
          待规划
        </Button>
      </nav>
      {props.children === undefined ? (
        visible.length === 0 ? (
          <ContentState title="当前筛选没有待安排课节" />
        ) : (
          <ul>
            {visible.map((item) => (
              <li key={item.lessonId}>{item.lessonId}</li>
            ))}
          </ul>
        )
      ) : (
        props.children(visible)
      )}
    </Panel>
  );
}
