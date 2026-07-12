export function StatisticsPanel(props: { readonly statistics: Readonly<Record<string, unknown>> }) {
  const metric = (key: string) =>
    typeof props.statistics[key] === 'number' ? (props.statistics[key] as number) : 0;
  const definitions = props.statistics.definitions as Record<string, string> | undefined;
  return (
    <section className="authoring-panel">
      <h2>学习统计</h2>
      <dl>
        <dt title={definitions?.totalActualSeconds}>总学习时长</dt>
        <dd>{metric('totalActualSeconds')}</dd>
        <dt title={definitions?.lessonCompletedCount}>完成课节</dt>
        <dd>{metric('lessonCompletedCount')}</dd>
        <dt title={definitions?.activeDayCount}>活跃天</dt>
        <dd>{metric('activeDayCount')}</dd>
        <dt title={definitions?.currentStreakDays}>连续学习日</dt>
        <dd>{metric('currentStreakDays')}</dd>
      </dl>
    </section>
  );
}
