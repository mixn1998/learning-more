import { useState } from 'react';

import type { WeeklyReportResponse, WeeklySummary } from '@learning-more/contracts';
import {
  AiContent,
  Badge,
  Button,
  ContentState,
  Grid,
  Inline,
  Panel,
  SectionHeader,
} from '@learning-more/ui';

export function WeeklyReportView(props: {
  readonly week?: WeeklySummary;
  readonly report?: WeeklyReportResponse;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <Panel className="weekly-report-panel">
      <SectionHeader
        title="本周回顾"
        actions={
          <Inline>
            {props.report?.state === 'finalized' ? <Badge tone="readonly">周报已冻结</Badge> : null}
            <Button
              aria-expanded={expanded}
              type="button"
              variant="ghost"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起周报' : '展开周报'}
            </Button>
          </Inline>
        }
      />
      {props.week === undefined ? null : (
        <Grid className="weekly-summary-grid" columns={3}>
          <p>
            <strong>{props.week.completedLessonCount}</strong>
            <small>完成课节</small>
          </p>
          <p>
            <strong>{props.week.actualSeconds}</strong>
            <small>学习秒数</small>
          </p>
          <p>
            <strong>{props.week.activeDayCount}</strong>
            <small>活跃天</small>
          </p>
        </Grid>
      )}
      {!expanded ? null : props.report?.state === 'finalized' &&
        props.report.markdown !== undefined ? (
        <AiContent markdown={props.report.markdown} />
      ) : props.report?.state === 'generating' ? (
        <ContentState title="周报生成中" description="完成后会冻结为只读版本。" />
      ) : props.report?.state === 'failed' ? (
        <ContentState
          role="alert"
          title="周报生成失败"
          description="学习事实不受影响，可稍后重试。"
        />
      ) : (
        <p className="lm-content-state">暂无周报</p>
      )}
    </Panel>
  );
}
