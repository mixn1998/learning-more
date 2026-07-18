import { useState } from 'react';

import type { WeeklyReportResponse, WeeklySummary } from '@learning-more/contracts';
import {
  AiContent,
  Badge,
  Button,
  ContentState,
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
      {!expanded ? null : props.report?.state === 'finalized' &&
        props.report.markdown !== undefined ? (
        <AiContent markdown={props.report.markdown} />
      ) : props.report?.state === 'generating' ? (
        <ContentState title="周报生成中" description="正在汇总上一完整周的完成课节。" />
      ) : props.report?.state === 'failed' ? (
        <ContentState
          role="alert"
          title="周报生成失败"
          description="完成课节事实不受影响，系统将自动重新汇总。"
        />
      ) : (
        <p className="lm-content-state">暂无周报</p>
      )}
    </Panel>
  );
}
