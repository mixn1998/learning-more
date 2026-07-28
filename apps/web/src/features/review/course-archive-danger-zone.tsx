import { useState } from 'react';

import { Button, Dialog } from '@learning-more/ui';

export function CourseArchiveDangerZone(props: {
  readonly courseTitle: string;
  readonly initiallyOpen?: boolean | undefined;
  readonly onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(props.initiallyOpen === true);
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
      setBusy(false);
    }
  };

  return (
    <>
      <div className="course-danger-row">
        <Button variant="danger" type="button" onClick={() => setOpen(true)}>
          删除课程
        </Button>
      </div>
      <Dialog
        className="delete-course-dialog"
        footer={
          <>
            <Button disabled={busy} type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button busy={busy} type="button" variant="danger" onClick={() => void confirm()}>
              {busy ? '正在删除…' : '永久删除'}
            </Button>
          </>
        }
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        open={open}
        title="永久删除课程？"
      >
        <div className="delete-course-body">
          <p>
            将永久删除 <strong>《{props.courseTitle}》</strong> 的课程档案、课节学习记录、Review
            与课程排期。
          </p>
          <p className="delete-course-note">
            此操作不可恢复。历史统计会从底层事实中扣除此课程，并基于剩余记录重新计算。
          </p>
          {error === undefined ? null : <p role="alert">{error}</p>}
        </div>
      </Dialog>
    </>
  );
}
