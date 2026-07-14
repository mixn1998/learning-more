import type { AiSurfaceContent } from '@learning-more/ui';
import { AiContent, AiSurface, Dialog } from '@learning-more/ui';

import './review-dialog.css';

export function ReviewDialog(props: {
  readonly markdown: string;
  readonly open: boolean;
  readonly title?: string;
  readonly courseTitle?: string;
  readonly generatedAt?: string;
  readonly content?: AiSurfaceContent;
  readonly onClose?: () => void;
  readonly onBackToOutline?: () => void;
  readonly onViewRecord?: () => void;
}) {
  return (
    <Dialog
      chrome="custom"
      className="lesson-review-overlay"
      initialFocusId="review-title"
      labelledBy="review-title"
      onClose={props.onClose ?? props.onBackToOutline ?? (() => undefined)}
      open={props.open}
    >
      <header className="lm-topbar lesson-review-topbar">
        <div className="lm-brand">
          <strong>Learning MORE</strong>
          <span>正式课程学习会话 · Review 已生成</span>
        </div>
        <div className="lm-topbar-tools">
          <div className="lm-global-runtime">
            <a className="lm-runtime-button ok" href="/runtime?tab=ai">
              <span aria-hidden="true" className="lm-runtime-dot" />
              <span>
                <b>AI 接口 · Codex</b>
                <small>连接正常</small>
              </span>
            </a>
            <a className="lm-runtime-button ok" href="/runtime?tab=service">
              <span aria-hidden="true" className="lm-runtime-dot" />
              <span>
                <b>本地服务 · 准备就绪</b>
                <small>实例与版本已核验</small>
              </span>
            </a>
          </div>
          <span className="lm-pill success">● 最终 Review 写入成功</span>
        </div>
      </header>
      <main className="lesson-review-stage">
        <section className="lm-card lesson-review-dialog">
          <header className="lesson-review-dialog-head">
            <div>
              <div className="lm-chips">
                <span className="lm-pill success">✓ 已完成</span>
                <span className="lm-mode-badge">● 标准模式</span>
                <span className="lm-pill readonly">永久只读</span>
              </div>
              <h1 className="lm-dialog-initial-focus" id="review-title" tabIndex={-1}>
                {props.title ?? '当前课节'}
              </h1>
              <p>
                《{props.courseTitle ?? '当前课程'}》· 生成于 {props.generatedAt ?? '刚刚'}
              </p>
            </div>
            <span className="lm-pill">课时 Review</span>
          </header>
          <div className="lesson-review-scroll">
            {props.content === undefined ? (
              <AiContent className="review-markdown" markdown={props.markdown} />
            ) : (
              <AiSurface className="review-markdown">{props.content}</AiSurface>
            )}
          </div>
          <footer className="lesson-review-dialog-foot">
            <div className="lm-actions">
              <button
                className="lm-btn"
                type="button"
                onClick={props.onBackToOutline ?? props.onClose}
              >
                返回课程大纲
              </button>
              <button className="lm-btn primary" type="button" onClick={props.onViewRecord}>
                查看课节记录
              </button>
            </div>
          </footer>
        </section>
      </main>
    </Dialog>
  );
}
