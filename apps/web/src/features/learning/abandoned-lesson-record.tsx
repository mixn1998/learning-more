export function AbandonedLessonRecord(props: {
  readonly learnedPoints: readonly string[];
  readonly remainingPoints: readonly string[];
  readonly stageReviewMarkdown?: string;
  readonly onViewRecord: () => void;
  readonly onRestore: () => void;
}) {
  return (
    <section aria-label="已放弃课节恢复导航">
      <h1>已放弃 · 恢复学习</h1>
      <h2>已学习核心知识点</h2>
      <ul>
        {props.learnedPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <h2>待完成核心知识点</h2>
      <ul>
        {props.remainingPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {props.stageReviewMarkdown === undefined ? null : (
        <article aria-label="现存阶段 Review">{props.stageReviewMarkdown}</article>
      )}
      <button type="button" onClick={props.onViewRecord}>
        查看记录
      </button>
      <button type="button" onClick={props.onRestore}>
        恢复学习
      </button>
    </section>
  );
}
