import { Field } from '@learning-more/ui';

export type HistoryFactFilter =
  | 'all'
  | 'LessonCompletedFact'
  | 'LessonAbandonedFact'
  | 'ReviewFinalizedFact'
  | 'CourseReviewFinalizedFact';

export function HistoryFilters(props: {
  readonly value: HistoryFactFilter;
  readonly onChange: (value: HistoryFactFilter) => void;
}) {
  return (
    <Field label="记录类型">
      <select
        aria-label="记录类型"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as HistoryFactFilter)}
      >
        <option value="all">全部学习事实</option>
        <option value="LessonCompletedFact">完成课节</option>
        <option value="LessonAbandonedFact">放弃课节</option>
        <option value="ReviewFinalizedFact">课时 Review</option>
        <option value="CourseReviewFinalizedFact">课程 Review</option>
      </select>
    </Field>
  );
}
