import { useEffect, useState } from 'react';

import type { AiSurfaceContent } from '@learning-more/ui';
import { AiContent, AiSurface } from '@learning-more/ui';

import './lesson-session-workspace.css';

export type LessonSessionMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  markdown?: string;
  content?: string | AiSurfaceContent;
  status?: 'submitting' | 'complete' | 'failed';
}>;

export type LessonPathPoint = Readonly<{
  title: string;
  detail: string;
  state: 'done' | 'active' | 'pending';
}>;

function formatTimer(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return {
    clock: `${minutes}:${String(seconds % 60).padStart(2, '0')}`,
    duration: `${minutes} 分 ${String(seconds % 60).padStart(2, '0')} 秒`,
  };
}

export function LessonSessionWorkspace(props: {
  readonly title: string;
  readonly courseTitle: string;
  readonly moduleLabel?: string;
  readonly outlineVersionLabel?: string;
  readonly messages: readonly LessonSessionMessage[];
  readonly path: readonly LessonPathPoint[];
  readonly elapsedSeconds: number;
  readonly input: string;
  readonly writable: boolean;
  readonly generating: boolean;
  readonly opening: boolean;
  readonly openingError: boolean;
  readonly assistantPending: boolean;
  readonly paused: boolean;
  readonly abandoned: boolean;
  readonly canComplete: boolean;
  readonly canStop: boolean;
  readonly stopped: boolean;
  readonly sendError?: string | undefined;
  readonly onInput: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly onTransfer: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onAbandon: () => void;
  readonly onRestore: () => void;
  readonly onRetryOpening: () => void;
  readonly onSkipOpening: () => void;
  readonly onComplete: () => void;
  readonly onBackToOutline: () => void;
}) {
  const [endOpen, setEndOpen] = useState(false);
  const timer = formatTimer(props.elapsedSeconds);
  const disabled = !props.writable || props.paused || props.abandoned || props.generating;

  useEffect(() => {
    if (!endOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEndOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [endOpen]);

  return (
    <div className="lesson-session-workspace">
      <header className="lm-topbar lesson-session-topbar">
        <div className="lm-brand">
          <strong>Learning MORE</strong>
          <span>正式课程学习会话</span>
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
          <span className={`lm-pill ${props.paused ? 'warning' : 'success'}`}>
            ● {props.paused ? '学习已暂停' : `正在计时 ${timer.clock}`}
          </span>
        </div>
      </header>
      <main className="lm-page lesson-session-page">
        <section className="lm-card lesson-hero">
          <div>
            <div className="lm-mode-badge">● 标准模式</div>
            <h1>{props.title}</h1>
            <p>
              《{props.courseTitle}》· {props.moduleLabel ?? '正式课程课节'} ·{' '}
              {props.outlineVersionLabel ?? '大纲 v1'}
            </p>
          </div>
          <div className="lm-actions">
            {props.abandoned ? (
              <button className="lm-btn primary" type="button" onClick={props.onRestore}>
                恢复学习
              </button>
            ) : !props.writable ? (
              <button className="lm-btn" type="button" onClick={props.onTransfer}>
                接管写入权
              </button>
            ) : props.paused ? (
              <button className="lm-btn" type="button" onClick={props.onResume}>
                继续学习
              </button>
            ) : null}
            <button
              className="lm-btn danger"
              disabled={!props.writable || props.abandoned}
              type="button"
              onClick={() => setEndOpen(true)}
            >
              结束本课
            </button>
            <button className="lm-btn" type="button" onClick={props.onBackToOutline}>
              返回课程大纲
            </button>
          </div>
        </section>
        <div className="lesson-session-layout">
          <section className="lm-card lesson-session-main">
            <header className="lesson-session-head">
              <strong>学习中 · 渐进式教学</strong>
              <div className="lm-actions">
                <span
                  className={`lm-pill ${props.generating ? 'warning' : props.stopped ? 'readonly' : 'success'}`}
                >
                  {props.generating
                    ? props.opening
                      ? 'AI 正在导入本课'
                      : '正在生成 Markdown'
                    : props.openingError
                      ? '开场未完成'
                      : props.stopped
                        ? '已停止生成'
                        : props.messages.length === 0
                          ? '准备开始'
                          : '等待你的回应'}
                </span>
                {props.generating && props.canStop ? (
                  <button className="lm-btn" type="button" onClick={props.onStop}>
                    停止生成
                  </button>
                ) : null}
              </div>
            </header>
            <div aria-label="学习对话" aria-live="polite" className="lesson-session-stream">
              {props.messages.length === 0 && !props.assistantPending ? (
                <div className="learn-ai">
                  {props.openingError ? (
                    <>
                      <p>AI 开场没有完成，你可以重试，或直接开始对话。</p>
                      <div className="lm-actions">
                        <button
                          className="lm-btn primary"
                          type="button"
                          onClick={props.onRetryOpening}
                        >
                          重试开场
                        </button>
                        <button className="lm-btn" type="button" onClick={props.onSkipOpening}>
                          直接开始对话
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>AI 导师正在准备本课的第一步。</p>
                  )}
                </div>
              ) : (
                props.messages.map((message) =>
                  message.role === 'assistant' ? (
                    <article aria-label="AI 导师" className="learn-ai" key={message.id}>
                      {message.markdown !== undefined ? (
                        <AiContent markdown={message.markdown} />
                      ) : typeof message.content === 'string' ? (
                        <AiContent markdown={message.content} />
                      ) : message.content === undefined ? null : (
                        <AiSurface>{message.content}</AiSurface>
                      )}
                    </article>
                  ) : (
                    <div
                      className="learn-user"
                      data-message-status={message.status}
                      key={message.id}
                    >
                      <span>{message.content ?? message.markdown}</span>
                      {message.status === 'failed' ? (
                        <small>发送失败 · 内容已恢复到输入框</small>
                      ) : null}
                    </div>
                  ),
                )
              )}
              {props.assistantPending ? (
                <article
                  aria-label="AI 回复状态"
                  className="learn-ai learn-ai-thinking"
                  role="status"
                >
                  正在思考中…
                </article>
              ) : null}
            </div>
            {props.sendError === undefined ? null : (
              <p className="lesson-send-error" role="alert">
                {props.sendError}
              </p>
            )}
            <div className="lesson-session-composer">
              <div className="lesson-session-input">
                <label className="sr-only" htmlFor="learning-session-input">
                  学习输入
                </label>
                <textarea
                  disabled={disabled}
                  id="learning-session-input"
                  placeholder="回答问题、追问，或要求换一种解释方式……"
                  value={props.input}
                  onChange={(event) => props.onInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      props.onSend();
                    }
                  }}
                />
                <button
                  className="lm-btn primary"
                  disabled={disabled}
                  type="button"
                  onClick={props.onSend}
                >
                  发送
                </button>
              </div>
            </div>
          </section>
          <aside className="lesson-session-side">
            <section className="lm-card">
              <h3>本课学习线索</h3>
              <ol aria-label="课节知识推进线索" className="learning-path">
                {props.path.map((point) => (
                  <li className={point.state} key={`${point.title}:${point.detail}`}>
                    <span className="node" />
                    <div>
                      <b>{point.title}</b>
                      <small>{point.detail}</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="lm-card">
              <h3>实际学习时长</h3>
              <strong>{timer.duration}</strong>
            </section>
          </aside>
        </div>
      </main>
      <div aria-hidden={!endOpen} className={`lesson-end-layer ${endOpen ? 'open' : ''}`}>
        <section
          aria-labelledby="lesson-end-title"
          aria-modal="true"
          className="lm-card lesson-end-card"
          role="dialog"
        >
          <div className="lm-kicker">教学尚未闭环</div>
          <h2 id="lesson-end-title">现在结束将放弃本课</h2>
          <p>原始会话冻结并生成阶段 Review；之后仍可恢复同一会话。</p>
          <div className="lesson-end-pending">
            <b>待完成</b>
            <br />
            <small>把状态、能力和目标反馈连接成可持续行动循环。</small>
          </div>
          <div className="lesson-end-pending">
            <b>待验证</b>
            <br />
            <small>用修改后的原型判断反馈是否改变下一步行为。</small>
          </div>
          <div className="lm-actions lesson-end-actions">
            <button className="lm-btn" type="button" onClick={() => setEndOpen(false)}>
              继续学习
            </button>
            {props.canComplete ? (
              <button
                className="lm-btn primary"
                type="button"
                onClick={() => {
                  setEndOpen(false);
                  props.onComplete();
                }}
              >
                完成本课
              </button>
            ) : null}
            <button
              className="lm-btn danger"
              type="button"
              onClick={() => {
                setEndOpen(false);
                props.onAbandon();
              }}
            >
              确认放弃课节
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
