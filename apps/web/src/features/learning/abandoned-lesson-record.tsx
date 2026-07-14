import { LessonNavigationWorkspace } from './lesson-navigation-workspace.js';
import { toKnowledgePointPresentation } from './knowledge-point-presentation.js';

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
          ...toKnowledgePointPresentation(point),
          marker: '✓',
          description: `已学习：${toKnowledgePointPresentation(point).summary}`,
        })),
        ...props.remainingPoints.map((point) => ({
          ...toKnowledgePointPresentation(point),
          marker: '→',
          description: `待完成：${toKnowledgePointPresentation(point).summary}`,
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
