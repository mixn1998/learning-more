import { Button } from '@learning-more/ui';

export function CandidateGenerationPending(props: {
  readonly cancelBusy?: boolean | undefined;
  readonly onCancel?: (() => void) | undefined;
}) {
  return (
    <div aria-label="候选大纲生成状态" className="ow-candidate-pending" role="status">
      <div className="ow-candidate-pending-copy">
        <span aria-hidden="true" className="ow-candidate-pending-indicator" />
        <span>
          <strong>正在生成候选大纲</strong>
          <small>AI 正在整理对话并组织课程结构，请稍候</small>
        </span>
      </div>
      {props.onCancel === undefined ? null : (
        <Button
          busy={props.cancelBusy === true}
          className="ow-candidate-cancel"
          disabled={props.cancelBusy === true}
          type="button"
          onClick={props.onCancel}
        >
          {props.cancelBusy ? '正在取消…' : '取消生成'}
        </Button>
      )}
    </div>
  );
}
