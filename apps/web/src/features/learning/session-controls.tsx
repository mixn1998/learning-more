export function SessionControls(props: {
  readonly generating: boolean;
  readonly writable: boolean;
  readonly abandoned: boolean;
  readonly paused: boolean;
  readonly onStop: () => void;
  readonly onTransfer: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onAbandon: () => void;
  readonly onRestore: () => void;
  readonly onFinish: () => void;
}) {
  return (
    <div className="session-controls">
      {props.generating ? (
        <button type="button" onClick={props.onStop}>
          停止生成
        </button>
      ) : null}
      {!props.writable ? (
        <button type="button" onClick={props.onTransfer}>
          接管写入权
        </button>
      ) : null}
      {props.writable && !props.abandoned && !props.paused ? (
        <>
          <button type="button" onClick={props.onPause}>
            暂停学习
          </button>
          <button type="button" onClick={props.onAbandon}>
            放弃课节
          </button>
          <button type="button" onClick={props.onFinish}>
            结束本课
          </button>
        </>
      ) : null}
      {props.writable && props.paused ? (
        <button type="button" onClick={props.onResume}>
          继续学习
        </button>
      ) : null}
      {props.abandoned ? (
        <button type="button" onClick={props.onRestore}>
          恢复学习
        </button>
      ) : null}
    </div>
  );
}
