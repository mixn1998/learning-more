import type { HistoryEntry } from '../../client/history-client.js';
import { Button, ContentState, Panel, SectionHeader } from '@learning-more/ui';

function historyEntryLabel(entry: HistoryEntry): string {
  const labels: Readonly<Record<string, string>> = {
    LessonCompletedFact: '完成课节',
    LessonAbandonedFact: '放弃课节',
    ReviewFinalizedFact: '完成课时 Review',
    CourseReviewFinalizedFact: '完成课程总 Review',
  };
  return labels[entry.factType] ?? '学习记录';
}

export function HistoryTimeline(props: {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor?: string;
  readonly onLoadMore: () => void;
  readonly onOpenCourseSummary?: (courseId: string) => void;
}) {
  return (
    <Panel className="history-timeline">
      <SectionHeader title="学习时间线" />
      {props.entries.length === 0 ? (
        <ContentState title="该日无完成课节" />
      ) : (
        <ol className="history-timeline-list">
          {props.entries.map((entry) => (
            <li key={entry.factId}>
              <time>{entry.occurredAt}</time> · {historyEntryLabel(entry)} ·{' '}
              {entry.subjectRefs.lessonId ?? entry.subjectRefs.courseId}
              {entry.factType !== 'LessonCompletedFact' ||
              entry.subjectRefs.courseId === undefined ||
              entry.subjectRefs.lessonId === undefined ? null : (
                <span>
                  {' · '}
                  <a href={`/courses/${entry.subjectRefs.courseId}`}>打开课程</a>
                  {' · '}
                  <a
                    href={`/courses/${entry.subjectRefs.courseId}/lessons/${entry.subjectRefs.lessonId}/record?tab=review`}
                  >
                    打开 Review
                  </a>
                </span>
              )}
              {entry.subjectRefs.courseId === undefined ||
              props.onOpenCourseSummary === undefined ? null : (
                <Button
                  className="history-summary-button"
                  type="button"
                  variant="ghost"
                  onClick={() => props.onOpenCourseSummary?.(entry.subjectRefs.courseId!)}
                >
                  课程摘要
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {props.nextCursor === undefined ? null : (
        <Button type="button" onClick={props.onLoadMore}>
          加载更多
        </Button>
      )}
    </Panel>
  );
}
