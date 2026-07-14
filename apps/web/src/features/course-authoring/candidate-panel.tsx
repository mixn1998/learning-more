import { AiContent, Button, ContentState, Inline } from '@learning-more/ui';
import type { CandidateGenerationFailureCode } from '@learning-more/contracts';

import { candidateGenerationFailurePresentation } from './candidate-generation-failure.js';

export function CandidatePanel(props: {
  readonly markdown: string;
  readonly state: 'generating' | 'ready' | 'failed' | 'confirmed';
  readonly failureCode?: CandidateGenerationFailureCode;
  readonly onGenerate: () => void;
  readonly onConfirm: () => void;
}) {
  if (props.state === 'failed') {
    const failure = candidateGenerationFailurePresentation(props.failureCode);
    return (
      <section className="authoring-panel">
        <ContentState title={failure.title} role="alert" />
        <p role="status">{failure.detail}</p>
        <Button type="button" onClick={props.onGenerate}>
          重试生成
        </Button>
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
        <AiContent markdown={props.markdown} />
        {props.state === 'ready' ? (
          <Inline>
            <Button type="button" onClick={props.onGenerate}>
              生成新版本
            </Button>
            <Button type="button" variant="primary" onClick={props.onConfirm}>
              确认此候选
            </Button>
          </Inline>
        ) : (
          <p>候选已确认</p>
        )}
      </section>
    );
  }
  return null;
}
