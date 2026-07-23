export function AssessmentPanel(props: {
  readonly value: string;
  readonly busy: boolean;
  readonly onChange: (value: string) => void;
  readonly onComplete: () => void;
}) {
  return (
    <section aria-labelledby="assessment-title" className="authoring-panel">
      <h2 id="assessment-title">正在评估课程需求</h2>
      <p>补充期望、已有基础或希望重点覆盖的内容。</p>
      <label>
        补充需求
        <textarea
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          rows={6}
        />
      </label>
      <button type="button" disabled={props.busy} onClick={props.onComplete}>
        完成评估
      </button>
    </section>
  );
}
