import { Fragment, useEffect, useState } from 'react';

import type { AiSurfaceContent } from '@learning-more/ui';
import { AiContent, AiSurface } from '@learning-more/ui';

import {
  ChatComposer,
  ConversationStream,
  RetryIcon,
  UserMessageRow,
} from '../../components/chat/chat.js';
import { BrandIdentity } from '../../components/brand/brand-identity.js';
import { LessonNotesPanel } from './lesson-notes-panel.js';

import './lesson-session-workspace.css';

export type LessonSessionMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  markdown?: string;
  content?: string | AiSurfaceContent;
  status?: 'submitting' | 'complete' | 'failed';
  knowledgePointRef?: string | undefined;
  knowledgePointTitle?: string | undefined;
}>;

export type LessonPathPoint = Readonly<{
  title: string;
  detail: string;
  state: 'done' | 'active' | 'pending';
  emphasis?: 'normal' | 'key' | 'difficult' | 'key_difficult';
}>;

function emphasisLabel(value: LessonPathPoint['emphasis']): string | undefined {
  if (value === 'key') return '重点';
  if (value === 'difficult') return '难点';
  if (value === 'key_difficult') return '重难点';
  return undefined;
}

function formatTimer(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return {
    clock: `${minutes}:${String(seconds % 60).padStart(2, '0')}`,
    duration: `${minutes} 分 ${String(seconds % 60).padStart(2, '0')} 秒`,
  };
}

function messageText(message: LessonSessionMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.markdown ?? '';
}

export function LessonSessionWorkspace(props: {
  readonly conversationKey?: string | undefined;
  readonly courseId: string;
  readonly lessonId: string;
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
  readonly continuationPending: boolean;
  readonly paused: boolean;
  readonly abandoned: boolean;
  readonly canComplete: boolean;
  readonly canStop: boolean;
  readonly canContinueTeaching: boolean;
  readonly stopped: boolean;
  readonly sendError?: string | undefined;
  readonly editableMessageId?: string | undefined;
  readonly retryableMessageId?: string | undefined;
  readonly retryLabel?: string | undefined;
  readonly editingMessageId?: string | undefined;
  readonly editingDraft: string;
  readonly editingSubmitDisabled: boolean;
  readonly onInput: (value: string) => void;
  readonly onSend: () => void;
  readonly onEditMessage: (messageId: string, markdown: string) => void;
  readonly onEditDraft: (value: string) => void;
  readonly onSubmitEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onRetryMessage: () => void;
  readonly onStop: () => void;
  readonly onContinueTeaching: () => void;
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
  const lastMessage = props.messages.at(-1);
  const lastUserMessage = props.messages.findLast((message) => message.role === 'user');
  const unfinishedPath = props.path.filter((point) => point.state !== 'done');
  const followKey = `${props.messages.length}:${lastMessage?.id ?? 'opening'}:${lastMessage === undefined ? 0 : messageText(lastMessage).length}:${props.assistantPending}`;

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
          <BrandIdentity subtitle="正式课程学习会话" />
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
          <span className={`lm-pill ${props.paused || props.generating ? 'warning' : 'success'}`}>
            ●{' '}
            {props.paused
              ? '学习已暂停'
              : props.generating
                ? props.assistantPending
                  ? 'AI 思考中 · 计时已暂停'
                  : '正在同步教学进度 · 计时已暂停'
                : `正在计时 ${timer.clock}`}
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
        </section>
        <div className="lesson-session-layout">
          <section className="lm-card lesson-session-main">
            <header className="lesson-session-head">
              <div className="lm-actions">
                <span
                  className={`lm-pill ${props.generating ? 'warning' : props.stopped ? 'readonly' : 'success'}`}
                >
                  {props.generating
                    ? props.opening
                      ? 'AI 正在导入本课'
                      : props.assistantPending
                        ? '正在生成 Markdown'
                        : '正在同步教学进度'
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
              <div className="lesson-session-controls">
                <h3 className="sr-only">实际学习时长</h3>
                <div className="lesson-session-compact-timer">
                  <span
                    className={`lesson-session-timer-status ${
                      props.abandoned || props.paused || props.generating ? 'paused' : 'active'
                    }`}
                  >
                    {props.abandoned
                      ? '已结束'
                      : props.paused
                        ? '已暂停'
                        : props.generating
                          ? props.assistantPending
                            ? 'AI 思考中'
                            : '同步中'
                          : '计时中'}
                  </span>
                  <strong className="lesson-session-duration">{timer.duration}</strong>
                </div>
                <div className="lesson-session-compact-actions">
                  {props.abandoned ? (
                    <button
                      className="lm-btn primary lesson-session-primary-action"
                      type="button"
                      onClick={props.onRestore}
                    >
                      恢复学习
                    </button>
                  ) : !props.writable ? (
                    <button
                      className="lm-btn primary lesson-session-primary-action"
                      type="button"
                      onClick={props.onTransfer}
                    >
                      接管写入权
                    </button>
                  ) : props.paused ? (
                    <button
                      className="lm-btn primary lesson-session-primary-action"
                      type="button"
                      onClick={props.onResume}
                    >
                      继续学习
                    </button>
                  ) : (
                    <button
                      className="lm-btn lesson-session-pause-button"
                      disabled={props.generating}
                      type="button"
                      onClick={props.onPause}
                    >
                      暂停
                    </button>
                  )}
                  <button
                    className="lm-btn lesson-session-end-button"
                    disabled={!props.writable || props.abandoned}
                    type="button"
                    onClick={() => setEndOpen(true)}
                  >
                    结束本课
                  </button>
                  <button
                    className="lm-btn lesson-session-outline-button"
                    type="button"
                    onClick={props.onBackToOutline}
                  >
                    返回课程大纲
                  </button>
                </div>
              </div>
            </header>
            <ConversationStream
              className="lesson-session-stream"
              followKey={followKey}
              forceFollowKey={`${props.conversationKey ?? 'lesson'}:${lastUserMessage?.id ?? 'opening'}`}
              generating={props.assistantPending && !props.opening}
              label="学习对话"
            >
              {props.messages.length === 0 && props.opening && props.assistantPending ? (
                <article
                  aria-label="AI 备课状态"
                  className="learn-ai learn-ai-thinking"
                  role="status"
                >
                  正在备课中，请稍等……
                </article>
              ) : props.messages.length === 0 && !props.assistantPending && props.openingError ? (
                <div className="learn-ai">
                  <p>AI 开场没有完成，你可以重试，或直接开始对话。</p>
                  <div className="lm-actions">
                    <button className="lm-btn primary" type="button" onClick={props.onRetryOpening}>
                      重试开场
                    </button>
                    <button className="lm-btn" type="button" onClick={props.onSkipOpening}>
                      直接开始对话
                    </button>
                  </div>
                </div>
              ) : (
                props.messages.map((message, index) => {
                  if (message.role === 'user') {
                    return (
                      <UserMessageRow
                        editing={props.editingMessageId === message.id}
                        editValue={props.editingDraft}
                        errorText="消息未发送"
                        key={message.id}
                        messageId={message.id}
                        onEdit={
                          props.editableMessageId === message.id
                            ? () => props.onEditMessage(message.id, messageText(message))
                            : undefined
                        }
                        onRetry={
                          props.retryableMessageId === message.id ? props.onRetryMessage : undefined
                        }
                        onEditCancel={props.onCancelEdit}
                        onEditChange={props.onEditDraft}
                        onEditSubmit={props.onSubmitEdit}
                        editSubmitDisabled={props.editingSubmitDisabled}
                        retryLabel={props.retryLabel}
                        status={message.status}
                        text={messageText(message)}
                      />
                    );
                  }

                  const previousAssistant = props.messages
                    .slice(0, index)
                    .findLast((candidate) => candidate.role === 'assistant');
                  const showKnowledgePointTitle =
                    message.knowledgePointRef !== undefined &&
                    message.knowledgePointTitle !== undefined &&
                    previousAssistant?.knowledgePointRef !== message.knowledgePointRef;
                  const showContinuationDivider =
                    index > 0 && props.messages[index - 1]?.role === 'assistant';

                  return (
                    <Fragment key={message.id}>
                      {showContinuationDivider ? (
                        <div
                          aria-hidden="true"
                          className="lesson-continuation-divider"
                          data-testid="continuation-divider"
                        />
                      ) : null}
                      {showKnowledgePointTitle ? (
                        <h2 className="lesson-knowledge-point-title">
                          {message.knowledgePointTitle}
                        </h2>
                      ) : null}
                      <article aria-label="AI 导师" className="learn-ai">
                        {message.markdown !== undefined ? (
                          <AiContent markdown={message.markdown} />
                        ) : typeof message.content === 'string' ? (
                          <AiContent markdown={message.content} />
                        ) : message.content === undefined ? null : (
                          <AiSurface>{message.content}</AiSurface>
                        )}
                        {props.retryableMessageId === message.id ? (
                          <footer className="learn-ai-meta">
                            <button
                              aria-label={props.retryLabel ?? '重新生成'}
                              className="chat-user-action"
                              title={props.retryLabel ?? '重新生成'}
                              type="button"
                              onClick={props.onRetryMessage}
                            >
                              <RetryIcon />
                            </button>
                          </footer>
                        ) : null}
                      </article>
                    </Fragment>
                  );
                })
              )}
              {props.assistantPending && !props.opening ? (
                <>
                  {props.continuationPending ? (
                    <div
                      aria-hidden="true"
                      className="lesson-continuation-divider"
                      data-testid="continuation-divider"
                    />
                  ) : null}
                  <article
                    aria-label="AI 回复状态"
                    className="learn-ai learn-ai-thinking"
                    role="status"
                  >
                    正在思考中…
                  </article>
                </>
              ) : null}
            </ConversationStream>
            {props.canContinueTeaching ? (
              <div className="lm-actions lesson-session-handoff">
                <button
                  className="lm-btn primary"
                  disabled={props.generating || !props.writable || props.paused || props.abandoned}
                  type="button"
                  onClick={props.onContinueTeaching}
                >
                  继续讲解
                </button>
              </div>
            ) : null}
            <ChatComposer
              busy={props.generating}
              className="lesson-session-composer"
              disabled={!props.writable || props.paused || props.abandoned}
              error={props.sendError}
              label="学习输入"
              placeholder="回答问题、追问，或要求换一种解释方式……"
              sendLabel="发送"
              submitDisabled={props.editingMessageId !== undefined}
              value={props.input}
              onChange={props.onInput}
              onSubmit={() => props.onSend()}
            />
          </section>
          <aside className="lesson-session-side">
            <section className="lm-card lesson-learning-path-panel">
              <h3>本课学习线索</h3>
              <ol aria-label="课节知识推进线索" className="learning-path">
                {props.path.map((point) => (
                  <li
                    aria-label={`${point.title}，${point.detail}`}
                    className={point.state}
                    key={`${point.title}:${point.detail}`}
                  >
                    <span className="node" />
                    <div>
                      <b>
                        {point.title}
                        {emphasisLabel(point.emphasis) === undefined ? null : (
                          <span className="learning-path-emphasis">
                            {emphasisLabel(point.emphasis)}
                          </span>
                        )}
                      </b>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <LessonNotesPanel
              courseId={props.courseId}
              lessonId={props.lessonId}
              lessonTitle={props.title}
            />
          </aside>
        </div>
      </main>
      <div aria-hidden={!endOpen} className={`lesson-end-layer ${endOpen ? 'open' : ''}`}>
        {endOpen ? (
          <section
            aria-labelledby="lesson-end-title"
            aria-modal="true"
            className="lm-card lesson-end-card"
            role="dialog"
          >
            <div className="lm-kicker">{props.canComplete ? '教学已闭环' : '教学尚未闭环'}</div>
            <h2 id="lesson-end-title">
              {props.canComplete ? '完成本课并生成 Review' : '现在结束将放弃本课'}
            </h2>
            <p>
              {props.canComplete
                ? '本课最终总结已经完成，可以结束学习并生成完整课时 Review。'
                : '原始会话将冻结并生成阶段 Review；之后仍可恢复同一会话。'}
            </p>
            {!props.canComplete ? (
              <div aria-label="未完成学习路径" className="lesson-end-pending-list" role="region">
                {unfinishedPath.map((point) => (
                  <div className="lesson-end-pending" key={`${point.title}:${point.detail}`}>
                    <b>{point.title}</b>
                    <br />
                    <small>{point.detail}</small>
                  </div>
                ))}
              </div>
            ) : null}
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
              {!props.canComplete ? (
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
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
