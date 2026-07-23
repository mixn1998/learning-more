import { Button, Dialog, Inline } from '@learning-more/ui';

export function DeleteDraftDialog(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error?: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const cancel = () => {
    if (!props.busy) props.onCancel();
  };
  return (
    <Dialog
      open={props.open}
      title="永久删除建档草稿？"
      onClose={cancel}
      footer={
        <Inline>
          <Button disabled={props.busy} type="button" onClick={cancel}>
            取消
          </Button>
          <Button busy={props.busy} type="button" variant="danger" onClick={props.onConfirm}>
            确认永久删除
          </Button>
        </Inline>
      }
    >
      <p>此操作将永久删除当前未确认建档会话、候选大纲、上传材料和生成草稿，且无法恢复。</p>
      {props.error === undefined ? null : <p role="alert">{props.error}</p>}
    </Dialog>
  );
}
