import type {
  LessonFinalReviewDocument,
  LessonStageReviewDocument,
  ReviewTextBlock,
} from '@learning-more/contracts';
import { AiContent } from '@learning-more/ui';

import './review-document-view.css';

function Block(props: { readonly block: ReviewTextBlock; readonly className?: string }) {
  return (
    <article className={props.className}>
      <h3>{props.block.title}</h3>
      <AiContent markdown={props.block.markdown} />
    </article>
  );
}

export function LessonFinalReviewDocumentView(props: {
  readonly document: LessonFinalReviewDocument;
}) {
  return (
    <article className="structured-review lesson-final-review-document">
      <h2>{props.document.title}</h2>
      <section>
        <h2>知识图谱</h2>
        <Block block={props.document.knowledgeMap} className="review-knowledge-map" />
      </section>
      <section>
        <h2>核心思想</h2>
        <AiContent markdown={props.document.coreInsight} />
      </section>
      <section>
        <h2>学习表现评价</h2>
        <div className="review-callout-list">
          {props.document.performance.map((block) => (
            <Block block={block} className="review-evaluation-card" key={block.title} />
          ))}
        </div>
      </section>
      {(props.document.additionalSections ?? []).map((block) => (
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
        <Block block={props.document.knowledgeMap} className="review-knowledge-map" />
      </section>
      <section>
        <h2>学习表现</h2>
        <div className="review-callout-list">
          {props.document.performance.map((block) => (
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
