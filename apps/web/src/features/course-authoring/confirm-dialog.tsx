import { Button, Dialog, Inline } from '@learning-more/ui';

export function ConfirmDialog(props: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open={props.open}
      title="确认课程大纲"
      onClose={props.onCancel}
      footer={
        <Inline>
          <Button type="button" onClick={props.onCancel}>
            返回检查
          </Button>
          <Button busy={props.busy} type="button" variant="primary" onClick={props.onConfirm}>
            确认创建课程
          </Button>
        </Inline>
      }
    >
      <p>确认后将创建不可变的正式课程版本。</p>
    </Dialog>
  );
}
