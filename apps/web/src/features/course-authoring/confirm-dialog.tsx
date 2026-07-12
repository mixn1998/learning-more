export function ConfirmDialog(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!props.open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-course-title" className="dialog">
      <h2 id="confirm-course-title">确认课程大纲</h2>
      <p>确认后将创建不可变的正式课程版本。</p>
      <button type="button" onClick={props.onCancel}>
        返回检查
      </button>
      <button type="button" disabled={props.busy} onClick={props.onConfirm}>
        确认创建课程
      </button>
    </div>
  );
}
