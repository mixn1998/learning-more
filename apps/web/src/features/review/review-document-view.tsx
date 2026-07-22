import type {
  LessonFinalReviewDocument,
  LessonStageReviewDocument,
  ReviewTextBlock,
} from '@learning-more/contracts';
import { AiContent } from '@learning-more/ui';

import { projectLessonReviewDocument } from './review-document-presentation.js';
import './review-document-view.css';

function Block(props: {
  readonly block: ReviewTextBlock;
  readonly className?: string;
  readonly hideTitle?: boolean;
}) {
  return (
    <article className={props.className}>
      {props.hideTitle ? null : <h3>{props.block.title}</h3>}
      <AiContent markdown={props.block.markdown} />
    </article>
  );
}

function KnowledgeMap(props: {
  readonly block: ReviewTextBlock;
  readonly nodes: readonly string[];
}) {
  if (props.nodes.length < 2) {
    return <Block block={props.block} className="review-knowledge-map" hideTitle />;
  }
  return (
    <div className="review-knowledge-map">
      <ol aria-label="本课知识关系主链" className="review-knowledge-chain">
        {props.nodes.map((node, index) => (
          <li key={`${index}:${node}`}>{node}</li>
        ))}
      </ol>
    </div>
  );
}

export function LessonFinalReviewDocumentView(props: {
  readonly document: LessonFinalReviewDocument;
  readonly legacyMarkdown?: string | undefined;
}) {
  const legacyPortableTakeaway = (
    props.document as LessonFinalReviewDocument & { readonly portableTakeaway?: unknown }
  ).portableTakeaway;
  const presentation = projectLessonReviewDocument({
    ...props.document,
    ...(props.document.methodologyInsight === undefined &&
    typeof legacyPortableTakeaway === 'string'
      ? { methodologyInsight: legacyPortableTakeaway }
      : {}),
    legacyMarkdown: props.legacyMarkdown,
  });
  return (
    <article className="structured-review lesson-final-review-document">
      <section>
        <h2>知识图谱</h2>
        <KnowledgeMap block={presentation.knowledgeMap} nodes={presentation.knowledgeMapNodes} />
      </section>
      {presentation.methodologyInsight === undefined ? null : (
        <section className="review-methodology-insight">
          <h2>本课方法论启示</h2>
          <AiContent markdown={presentation.methodologyInsight} />
        </section>
      )}
      <section>
        <h2>核心思想</h2>
        <AiContent markdown={presentation.coreInsight} />
      </section>
      <section>
        <h2>学习表现评价</h2>
        <div className="review-callout-list">
          {presentation.performance.map((block) => (
            <Block block={block} className="review-evaluation-card" key={block.title} />
          ))}
        </div>
      </section>
      {presentation.adjacentExploration.map((block) => (
        <section key={block.title}>
          <h2>{block.title}</h2>
          <AiContent markdown={block.markdown} />
        </section>
      ))}
    </article>
  );
}

export function LessonStageReviewDocumentView(props: {
  readonly document: LessonStageReviewDocument;
}) {
  const presentation = projectLessonReviewDocument({ ...props.document, coreInsight: '' });
  return (
    <article className="structured-review lesson-stage-review-document">
      <h2>{props.document.title}</h2>
      <AiContent className="stage-review-lead" markdown={props.document.lead} />
      <div className="stage-review-status-grid">
        <section>
          <h2>已建立的理解</h2>
          {props.document.establishedUnderstanding.map((block) => (
            <Block block={block} key={block.title} />
          ))}
        </section>
        <section>
          <h2>尚待验证的内容</h2>
          {props.document.pendingValidation.map((block) => (
            <Block block={block} key={block.title} />
          ))}
        </section>
      </div>
      <section>
        <h2>当前知识线索</h2>
        <KnowledgeMap block={presentation.knowledgeMap} nodes={presentation.knowledgeMapNodes} />
      </section>
      <section>
        <h2>学习表现</h2>
        <div className="review-callout-list">
          {presentation.performance.map((block) => (
            <Block block={block} className="review-evaluation-card" key={block.title} />
          ))}
        </div>
      </section>
      <AiContent
        className="stage-review-continuation"
        markdown={props.document.continuationNotice}
      />
      {(props.document.additionalSections ?? []).map((block) => (
        <section key={block.title}>
          <h2>{block.title}</h2>
          <AiContent markdown={block.markdown} />
        </section>
      ))}
    </article>
  );
}
