import { LessonNavigationWorkspace } from './lesson-navigation-workspace.js';
import { toKnowledgePointPresentation } from './knowledge-point-presentation.js';

export function AbandonedLessonRecord(props: {
  readonly learnedPoints: readonly string[];
  readonly remainingPoints: readonly string[];
  readonly stageReviewMarkdown?: string;
  readonly stageReviewStatus?: 'generating' | 'failed' | 'ready';
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
        })),
        ...props.remainingPoints.map((point) => ({
          ...toKnowledgePointPresentation(point),
          marker: '→',
        })),
      ]}
      state="abandoned"
      {...(props.stageReviewStatus === 'generating'
        ? {
            statusMessage:
              '阶段性 Review 正在生成中，可稍后返回课程页面查看；原始对话已经可以查看。',
          }
        : props.stageReviewStatus === 'failed'
          ? { statusMessage: '阶段性 Review 生成失败，但原始对话与课节档案仍可正常查看。' }
          : {})}
      title={props.title ?? '恢复当前课节'}
      onBackHome={props.onBackHome ?? (() => undefined)}
      onBackToOutline={props.onBackToOutline ?? (() => undefined)}
      onPrimary={props.onRestore}
      onViewRecord={props.onViewRecord}
    />
  );
}
