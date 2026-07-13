import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

export function CandidatePanel(props: {
  readonly markdown: string;
  readonly state: 'generating' | 'ready' | 'failed' | 'confirmed';
  readonly onGenerate: () => void;
  readonly onConfirm: () => void;
}) {
  if (props.state === 'failed') {
    return (
      <section className="authoring-panel">
        <p role="alert">生成中断，草稿已保留。</p>
        <p role="status">未完成内容会在重试时继续使用。</p>
        <button type="button" onClick={props.onGenerate}>
          重试生成
        </button>
      </section>
    );
  }
  if (props.state === 'generating') {
    return (
      <section className="authoring-panel" aria-live="polite">
        正在生成候选大纲…
      </section>
    );
  }
  if (props.state === 'ready' || props.state === 'confirmed') {
    return (
      <section className="authoring-panel candidate-markdown">
        <Markdown rehypePlugins={[rehypeSanitize]}>{props.markdown}</Markdown>
        {props.state === 'ready' ? (
          <div>
            <button type="button" onClick={props.onGenerate}>
              生成新版本
            </button>
            <button type="button" onClick={props.onConfirm}>
              确认此候选
            </button>
          </div>
        ) : (
          <p>候选已确认</p>
        )}
      </section>
    );
  }
  return null;
}
