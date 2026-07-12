export function GlobalProfilePanel(props: { readonly profile: Readonly<Record<string, unknown>> }) {
  const sufficiency = props.profile.sufficiency as
    | { status?: string; activeEvidenceCount?: number; independentSourceGroupCount?: number }
    | undefined;
  const freshness =
    typeof props.profile.freshness === 'string' ? props.profile.freshness : 'current';
  return (
    <section className="authoring-panel">
      <h2>全局学习档案</h2>
      {freshness === 'current' ? null : <p role="status">档案状态：{freshness}</p>}
      <p>数据充分度：{sufficiency?.status ?? 'insufficient'}</p>
      <p>有效候选证据：{sufficiency?.activeEvidenceCount ?? 0}</p>
      <p>独立来源：{sufficiency?.independentSourceGroupCount ?? 0}</p>
    </section>
  );
}
