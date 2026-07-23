import type { StatisticsResponse } from '@learning-more/contracts';
import { Card, Grid, SectionHeader } from '@learning-more/ui';

const metrics = [
  ['totalActualSeconds', '总学习时长', '秒'],
  ['lessonCompletedCount', '完成课节', '节'],
  ['activeDayCount', '活跃天', '天'],
  ['currentStreakDays', '连续学习日', '天'],
] as const;

export function StatisticsPanel(props: { readonly statistics: StatisticsResponse }) {
  return (
    <section aria-labelledby="history-statistics-title">
      <SectionHeader title={<span id="history-statistics-title">学习统计</span>} />
      <Grid className="history-metric-grid" columns={4}>
        {metrics.map(([key, label, unit]) => (
          <Card key={key}>
            <p className="eyebrow" title={props.statistics.definitions[key]}>
              {label}
            </p>
            <p className="history-metric-value">
              {props.statistics[key]} <small>{unit}</small>
            </p>
          </Card>
        ))}
      </Grid>
    </section>
  );
}
