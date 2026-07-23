import { useMemo, useState } from 'react';

import type { CalendarDay } from '@learning-more/contracts';
import { Button, ContentState, Inline, Panel, SectionHeader } from '@learning-more/ui';

function monthOf(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 7);
}

function adjacentMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return monthOf(new Date(year, number - 1 + offset, 15));
}

export function CalendarView(props: {
  readonly days: readonly CalendarDay[];
  readonly selectedDate?: string;
  readonly onSelect: (date: string) => void;
}) {
  const [month, setMonth] = useState(monthOf(new Date()));
  const visibleDays = useMemo(
    () => props.days.filter((day) => day.localDate.startsWith(`${month}-`)),
    [month, props.days],
  );
  return (
    <Panel className="history-calendar">
      <SectionHeader
        title="学习日历"
        description="按上海时区汇总已完成课节与实际学习时长。"
        actions={
          <Inline>
            <Button
              aria-label="上一个月"
              type="button"
              variant="ghost"
              onClick={() => setMonth((value) => adjacentMonth(value, -1))}
            >
              ‹
            </Button>
            <strong aria-live="polite">{month}</strong>
            <Button
              aria-label="下一个月"
              type="button"
              variant="ghost"
              onClick={() => setMonth((value) => adjacentMonth(value, 1))}
            >
              ›
            </Button>
          </Inline>
        }
      />
      {visibleDays.length === 0 ? (
        <ContentState title="本月还没有完成记录" description="完成课节后会在这里形成可追溯日历。" />
      ) : (
        <ul className="history-calendar-grid" aria-label="有学习记录的日期">
          {visibleDays.map((day) => (
            <li key={day.localDate}>
              <button
                type="button"
                aria-pressed={day.localDate === props.selectedDate}
                onClick={() => props.onSelect(day.localDate)}
              >
                <time dateTime={day.localDate}>{day.localDate}</time>
                <strong>{day.actualSeconds}s</strong>
                <small>{day.completedLessonIds.length} 节</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
