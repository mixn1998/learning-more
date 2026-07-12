import type { HistoryEntry } from '../../client/history-client.js';

export function HistoryTimeline(props: {
  readonly entries: readonly HistoryEntry[];
  readonly nextCursor?: string;
  readonly onLoadMore: () => void;
}) {
  return (
    <section className="authoring-panel">
      <h2>学习时间线</h2>
      {props.entries.length === 0 ? (
        <p>该日无完成课节</p>
      ) : (
        <ol>
          {props.entries.map((entry) => (
            <li key={entry.factId}>
              <time>{entry.occurredAt}</time> · {entry.factType} ·{' '}
              {entry.subjectRefs.lessonId ?? entry.subjectRefs.courseId}
            </li>
          ))}
        </ol>
      )}
      {props.nextCursor === undefined ? null : (
        <button type="button" onClick={props.onLoadMore}>
          加载更多
        </button>
      )}
    </section>
  );
}
