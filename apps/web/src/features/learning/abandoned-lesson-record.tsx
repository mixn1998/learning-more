import { LessonNavigationWorkspace } from './lesson-navigation-workspace.js';

export function AbandonedLessonRecord(props: {
  readonly learnedPoints: readonly string[];
  readonly remainingPoints: readonly string[];
  readonly stageReviewMarkdown?: string;
  readonly title?: string;
  readonly courseTitle?: string;
  readonly outlineVersionLabel?: string;
  readonly onViewRecord: () => void;
  readonly onRestore: () => void;
  readonly onBackToOutline?: () => void;
  readonly onBackHome?: () => void;
}) {
  return (
    <LessonNavigationWorkspace
      courseTitle={props.courseTitle ?? '当前课程'}
      {...(props.outlineVersionLabel === undefined
        ? {}
        : { outlineVersionLabel: props.outlineVersionLabel })}
      points={[
        ...props.learnedPoints.map((point) => ({
          marker: '✓',
          title: `已学习：${point}`,
          description: '此知识点已在冻结的原始学习会话中形成可追溯证据。',
        })),
        ...props.remainingPoints.map((point) => ({
          marker: '→',
          title: `待完成：${point}`,
          description: '恢复同一会话后继续推进，不会把既有学习证据重新计入。',
        })),
      ]}
      state="abandoned"
      title={props.title ?? '恢复当前课节'}
      onBackHome={props.onBackHome ?? (() => undefined)}
      onBackToOutline={props.onBackToOutline ?? (() => undefined)}
      onPrimary={props.onRestore}
      onViewRecord={props.onViewRecord}
    />
  );
}
