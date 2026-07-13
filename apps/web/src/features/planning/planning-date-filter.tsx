import { useMemo, useState } from 'react';

export type PlanningDateItem = Readonly<{
  lessonId: string;
  plannedLocalDate?: string;
  progress?: 'not_started' | 'in_progress' | 'abandoned' | 'completed';
}>;

export function PlanningDateFilter(props: { readonly items: readonly PlanningDateItem[] }) {
  const candidates = useMemo(
    () =>
      props.items.filter((item) => item.progress !== 'abandoned' && item.progress !== 'completed'),
    [props.items],
  );
  const dates = useMemo(
    () => [...new Set(candidates.flatMap((item) => item.plannedLocalDate ?? []))].sort(),
    [candidates],
  );
  const [selection, setSelection] = useState<string>(dates[0] ?? 'pending');
  const visible = candidates.filter((item) =>
    selection === 'pending'
      ? item.plannedLocalDate === undefined
      : item.plannedLocalDate === selection,
  );
  return (
    <section aria-label="周历联动筛选">
      <nav aria-label="计划日期">
        {dates.map((date) => (
          <button key={date} type="button" onClick={() => setSelection(date)}>
            {date}
          </button>
        ))}
        <button type="button" onClick={() => setSelection('pending')}>
          待规划
        </button>
      </nav>
      <ul>
        {visible.map((item) => (
          <li key={item.lessonId}>{item.lessonId}</li>
        ))}
      </ul>
    </section>
  );
}
