import type { CourseSummary } from '@learning-more/contracts';
import { Button, ContentState, Dialog, Grid, Stack } from '@learning-more/ui';

export function CourseSummaryDrawer(props: {
  readonly open: boolean;
  readonly courseId?: string;
  readonly summary?: CourseSummary;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      title="课程学习摘要"
      onClose={props.onClose}
      footer={<Button onClick={props.onClose}>关闭摘要</Button>}
    >
      <Stack>
        <p>课程：{props.courseId}</p>
        {props.loading ? <ContentState title="正在读取课程摘要" /> : null}
        {props.error === undefined ? null : <ContentState role="alert" title={props.error} />}
        {props.summary === undefined ? null : (
          <Grid className="course-summary-grid" columns={3}>
            <p>
              <strong>{props.summary.completedLessonCount}</strong>
              <small>完成课节</small>
            </p>
            <p>
              <strong>{props.summary.actualSeconds}</strong>
              <small>实际学习秒数</small>
            </p>
            <p>
              <strong>{props.summary.finalReviewCount}</strong>
              <small>最终 Review</small>
            </p>
          </Grid>
        )}
      </Stack>
    </Dialog>
  );
}
