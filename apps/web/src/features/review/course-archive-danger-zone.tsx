import { useState } from 'react';

export function CourseArchiveDangerZone(props: { readonly onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.onDelete();
    } catch {
      setError('删除失败，课程及现有数据已完整保留。你可以重试或取消。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="course-danger-zone" aria-label="危险操作">
      <h2>危险操作</h2>
      <p>永久移除这门正式课程及其全部关联学习档案。</p>
      <button type="button" className="danger-button" onClick={() => setOpen(true)}>
        删除课程
      </button>
      {!open ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-course-title"
          className="danger-dialog"
        >
          <h2 id="delete-course-title">永久删除课程？</h2>
          <p>此操作不可恢复，并会永久删除或撤销以下数据：</p>
          <ul>
            <li>课程档案与全部大纲版本</li>
            <li>学习记录与补充学习会话</li>
            <li>课时 Review 与课程主题总 Review</li>
            <li>排期与计划流条目</li>
            <li>历史统计与学习日历贡献</li>
            <li>学习画像证据与相关结论</li>
          </ul>
          {error === undefined ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? '正在永久删除…' : '永久删除'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
