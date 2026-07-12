export function WeeklyReportView(props: {
  readonly week?: Readonly<Record<string, unknown>>;
  readonly report?: Readonly<Record<string, unknown>>;
}) {
  return (
    <section className="authoring-panel">
      <h2>上周回顾</h2>
      {props.week === undefined ? null : <pre>{JSON.stringify(props.week, null, 2)}</pre>}
      {props.report?.state === 'finalized' ? (
        <>
          <p role="status">周报已冻结</p>
          <pre>{String(props.report.markdown ?? '')}</pre>
        </>
      ) : (
        <p>暂无周报</p>
      )}
    </section>
  );
}
