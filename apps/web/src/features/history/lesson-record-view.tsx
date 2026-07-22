import { useState } from 'react';

import type { AiSurfaceContent } from '@learning-more/ui';
import { AiContent, AiSurface, tabId, tabPanelId, Tabs } from '@learning-more/ui';
import type { ReviewDocument } from '@learning-more/contracts';

import {
  ChatComposer,
  ConversationStream,
  RetryIcon,
  UserMessageRow,
} from '../../components/chat/chat.js';
import type { SupplementarySessionView } from '../../client/lesson-record-client.js';
import { BrandIdentity } from '../../components/brand/brand-identity.js';
import {
  LessonFinalReviewDocumentView,
  LessonStageReviewDocumentView,
} from '../review/review-document-view.js';
import { projectLegacyReviewMarkdown } from '../review/review-document-presentation.js';

import './lesson-record-view.css';

type SessionRecord = Readonly<{
  sessionId: string;
  label: string;
  messages: readonly Readonly<{
    id: string;
    role: 'user' | 'assistant';
    markdown: string;
    completionStatus?: 'complete' | 'interrupted';
    generationTaskId?: string;
  }>[];
  status?: 'active' | 'archived';
  resourceVersion?: number;
  meta?: string;
}>;

const lessonRecordTabs = [
  { id: 'conversation', label: '学习对话' },
  { id: 'review', label: '课时 Review' },
] as const;

const lessonRecordTabsIdPrefix = 'lesson-record-content';

function durationLabel(seconds: number | undefined) {
  if (seconds === undefined) return '时长已归档';
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

function reviewFailureReason(errorCode: string | undefined): string {
  switch (errorCode) {
    case 'review_evidence_pack_incomplete':
      return 'Review 所需的学习证据不完整，生成任务未能继续。';
    case 'review_checkpoint_incomplete':
      return 'Review 所需的学习检查点尚未完整。';
    case 'review_checkpoint_identity_mismatch':
      return 'Review 检查点与当前课节不匹配。';
    case 'final_review_transaction_missing':
      return '没有找到本课对应的最终 Review 生成记录。';
    case 'final_review_artifact_missing':
      return '最终 Review 记录已完成，但生成内容缺失。';
    case undefined:
      return 'Review 生成任务未能完成。';
    default:
      return `Review 生成任务未能完成（${errorCode}）。`;
  }
}

export function LessonRecordView(props: {
  readonly original: SessionRecord;
  readonly supplementary: readonly SessionRecord[];
  readonly activeSupplementary?: SupplementarySessionView;
  readonly assistantMarkdown?: string;
  readonly finalReviewMarkdown?: string;
  readonly progress?: 'in_progress' | 'abandoned' | 'completed';
  readonly reviewKind?: 'stage' | 'final';
  readonly reviewStatus?: 'generating' | 'failed' | 'ready';
  readonly reviewErrorCode?: string;
  readonly reviewRetryBusy?: boolean;
  readonly reviewRetryError?: string;
  readonly initialTab?: 'conversation' | 'review';
  readonly title?: string;
  readonly courseTitle?: string;
  readonly completedAt?: string;
  readonly actualSeconds?: number;
  readonly reviewContent?: AiSurfaceContent;
  readonly reviewDocument?: ReviewDocument;
  readonly onBackHome?: () => void;
  readonly onBackToOutline?: () => void;
  readonly onRetryReview?: (() => Promise<void>) | undefined;
  readonly onStartSupplementary?: (() => Promise<{ sessionId: string }>) | undefined;
  readonly onSendSupplementary?:
    ((sessionId: string, markdown: string) => Promise<void>) | undefined;
  readonly onReviseSupplementary?:
    ((messageId: string, markdown: string) => Promise<void>) | undefined;
  readonly onRetrySupplementary?: (() => Promise<void>) | undefined;
  readonly onStopSupplementary?: (() => Promise<void>) | undefined;
  readonly onArchiveSupplementary?: (() => Promise<string>) | undefined;
  readonly onRenameSupplementary?:
    ((sessionId: string, title: string, resourceVersion: number) => Promise<void>) | undefined;
}) {
  const [topTab, setTopTab] = useState<'conversation' | 'review'>(
    props.initialTab ?? 'conversation',
  );
  const [sessionId, setSessionId] = useState(props.original.sessionId);
  const [supplementaryInput, setSupplementaryInput] = useState('');
  const [supplementaryBusy, setSupplementaryBusy] = useState(false);
  const [supplementaryError, setSupplementaryError] = useState<string>();
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const [editingDraft, setEditingDraft] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [renamingDraft, setRenamingDraft] = useState('');
  const [renameError, setRenameError] = useState<string>();
  const sessions = [props.original, ...props.supplementary];
  const selected = sessions.find((session) => session.sessionId === sessionId) ?? props.original;
  const selectedIsActive =
    selected.sessionId === props.activeSupplementary?.id &&
    props.activeSupplementary.status === 'active';
  const supplementaryGenerating =
    selectedIsActive && props.activeSupplementary?.activeGenerationTaskId !== undefined;
  const supplementaryRetryAvailable =
    props.activeSupplementary?.generationErrorCode !== undefined ||
    props.activeSupplementary?.messages?.at(-1)?.completionStatus === 'interrupted';
  const date = props.completedAt ?? '完成时间已归档';
  const duration = durationLabel(props.actualSeconds);
  const progressLabel = props.progress === 'abandoned' ? '已结束' : '已完成';
  return (
    <div className="lesson-record-workspace">
      <header className="lm-topbar lesson-record-topbar">
        <div className="lm-brand">
          <BrandIdentity subtitle="只读课节记录" />
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
          <span className="lm-pill readonly">● 归档完整</span>
        </div>
      </header>
      <main className="lm-page lesson-record-page" aria-label="课节记录">
        <section className="lm-card lesson-hero">
          <div>
            <div className="lm-mode-badge">● 标准模式</div>
            <div className="lm-kicker lesson-record-kicker">{progressLabel} · 课节记录</div>
            <h1>{props.title ?? '课节记录'}</h1>
            <p>
              《{props.courseTitle ?? '当前课程'}》· {date} · {duration}
            </p>
          </div>
          <div className="lm-actions">
            <button className="lm-btn" type="button" onClick={props.onBackHome}>
              返回主页
            </button>
            <button className="lm-btn" type="button" onClick={props.onBackToOutline}>
              返回课程大纲
            </button>
          </div>
        </section>
        <section className="lm-card lesson-record-card">
          <Tabs
            active={topTab}
            as="nav"
            className="lesson-record-tabs"
            idPrefix={lessonRecordTabsIdPrefix}
            label="课节记录内容"
            onChange={setTopTab}
            options={lessonRecordTabs}
            renderInactivePanels
            tabClassName={(_option, active) => `lm-tab ${active ? 'active' : ''}`}
          >
            <span className="lm-pill readonly">永久只读</span>
          </Tabs>
          {topTab === 'review' ? (
            <section
              aria-labelledby={tabId(lessonRecordTabsIdPrefix, 'review')}
              className="lesson-record-panel active"
              id={tabPanelId(lessonRecordTabsIdPrefix, 'review')}
              role="tabpanel"
              tabIndex={0}
            >
              <article aria-label="权威课时 Review" className="lesson-record-review">
                {props.reviewDocument?.kind === 'lesson-final' ? (
                  <LessonFinalReviewDocumentView
                    document={props.reviewDocument}
                    legacyMarkdown={props.finalReviewMarkdown}
                  />
                ) : props.reviewDocument?.kind === 'lesson-stage' ? (
                  <LessonStageReviewDocumentView document={props.reviewDocument} />
                ) : props.reviewContent !== undefined ? (
                  <AiSurface className="review-content">{props.reviewContent}</AiSurface>
                ) : props.finalReviewMarkdown !== undefined ? (
                  <AiContent
                    className="review-content"
                    markdown={projectLegacyReviewMarkdown(props.finalReviewMarkdown)}
                  />
                ) : props.reviewStatus === 'failed' ? (
                  <div className="lesson-record-review-failure" role="alert">
                    <h2>Review 生成失败</h2>
                    <p>{reviewFailureReason(props.reviewErrorCode)}</p>
                    {props.onRetryReview === undefined ? null : (
                      <button
                        className="lm-btn"
                        disabled={props.reviewRetryBusy}
                        type="button"
                        onClick={() => void props.onRetryReview!()}
                      >
                        {props.reviewRetryBusy ? '正在重试…' : '重新生成 Review'}
                      </button>
                    )}
                    {props.reviewRetryError === undefined ? null : (
                      <p className="lm-form-error">{props.reviewRetryError}</p>
                    )}
                  </div>
                ) : (
                  <p role="status">
                    {props.reviewKind === 'final'
                      ? '最终课时 Review 正在生成中，可稍后返回本页查看。'
                      : '阶段性 Review 正在生成中，可稍后返回本页查看。'}
                  </p>
                )}
              </article>
            </section>
          ) : (
            <section
              aria-labelledby={tabId(lessonRecordTabsIdPrefix, 'conversation')}
              className="lesson-record-panel active"
              id={tabPanelId(lessonRecordTabsIdPrefix, 'conversation')}
              role="tabpanel"
              tabIndex={0}
            >
              <div className="lesson-record-chat-layout">
                <aside className="lesson-record-sessions" aria-label="会话时间线">
                  <h3>学习会话</h3>
                  <p>原始学习与补充学习分别归档；补充学习不会改变最终 Review。</p>
                  {sessions.map((session, index) => {
                    if (index === 0) {
                      return (
                        <button
                          aria-label={session.label}
                          className={`lesson-record-session ${session.sessionId === selected.sessionId ? 'active' : ''}`}
                          key={session.sessionId}
                          type="button"
                          onClick={() => setSessionId(session.sessionId)}
                        >
                          <b>{session.label}</b>
                          <span>{session.meta ?? `${date} · ${duration}`}</span>
                        </button>
                      );
                    }
                    const canRename =
                      session.resourceVersion !== undefined &&
                      props.onRenameSupplementary !== undefined;
                    const isRenaming = renamingSessionId === session.sessionId;
                    return (
                      <div className="lesson-record-session-row" key={session.sessionId}>
                        {isRenaming ? (
                          <form
                            className="lesson-record-session-rename-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const title = renamingDraft.trim();
                              if (!canRename || title === '') return;
                              setSupplementaryBusy(true);
                              setRenameError(undefined);
                              void props.onRenameSupplementary!(
                                session.sessionId,
                                title,
                                session.resourceVersion!,
                              ).then(
                                () => {
                                  setRenamingSessionId(undefined);
                                  setRenamingDraft('');
                                  setSupplementaryBusy(false);
                                },
                                () => {
                                  setRenameError('补充会话重命名失败，请重试。');
                                  setSupplementaryBusy(false);
                                },
                              );
                            }}
                          >
                            <input
                              autoFocus
                              aria-label={`重命名 ${session.label}`}
                              maxLength={30}
                              value={renamingDraft}
                              onChange={(event) => setRenamingDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key !== 'Escape') return;
                                setRenamingSessionId(undefined);
                                setRenamingDraft('');
                              }}
                            />
                            <button
                              aria-label="确认重命名"
                              className="lm-btn primary"
                              disabled={supplementaryBusy || renamingDraft.trim() === ''}
                              type="submit"
                            >
                              保存
                            </button>
                          </form>
                        ) : (
                          <button
                            aria-label={session.label}
                            className={`lesson-record-session ${session.sessionId === selected.sessionId ? 'active' : ''}`}
                            type="button"
                            onClick={() => setSessionId(session.sessionId)}
                          >
                            <b
                              className={
                                canRename ? 'lesson-record-session-title-editable' : undefined
                              }
                              onClick={(event) => {
                                if (!canRename) return;
                                event.stopPropagation();
                                setRenamingSessionId(session.sessionId);
                                setRenamingDraft(session.label);
                                setRenameError(undefined);
                              }}
                            >
                              {session.label}
                            </b>
                            <span>{session.meta ?? '独立补充学习归档'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {renameError === undefined ? null : (
                    <p className="lm-form-error" role="alert">
                      {renameError}
                    </p>
                  )}
                  {props.activeSupplementary?.status === 'active' &&
                  props.onArchiveSupplementary !== undefined ? (
                    <button
                      className="lm-btn lesson-record-start-supplementary"
                      disabled={supplementaryBusy}
                      type="button"
                      onClick={() => {
                        setSupplementaryBusy(true);
                        setSupplementaryError(undefined);
                        void props.onArchiveSupplementary!().then(
                          () => {
                            setSessionId(props.original.sessionId);
                            setSupplementaryBusy(false);
                          },
                          () => {
                            setSupplementaryError('关闭本轮学习失败，请重试。');
                            setSupplementaryBusy(false);
                          },
                        );
                      }}
                    >
                      关闭本轮学习
                    </button>
                  ) : props.progress === 'completed' && props.onStartSupplementary !== undefined ? (
                    <button
                      className="lm-btn lesson-record-start-supplementary"
                      disabled={supplementaryBusy}
                      type="button"
                      onClick={() => {
                        setSupplementaryBusy(true);
                        setSupplementaryError(undefined);
                        void props.onStartSupplementary!().then(
                          (created) => {
                            setSessionId(created.sessionId);
                            setSupplementaryBusy(false);
                          },
                          () => {
                            setSupplementaryError('补充学习创建失败，请重试。');
                            setSupplementaryBusy(false);
                          },
                        );
                      }}
                    >
                      开始补充学习
                    </button>
                  ) : null}
                </aside>
                <main className="lesson-record-chat-column">
                  <ConversationStream
                    className="lesson-record-chat"
                    followKey={`${selected.sessionId}:${selected.messages.length}:${props.assistantMarkdown?.length ?? 0}`}
                    forceFollowKey={selected.sessionId}
                    generating={supplementaryGenerating}
                    label={selectedIsActive ? '补充学习对话' : '只读学习对话'}
                  >
                    {selected.messages.map((message) =>
                      message.role === 'assistant' ? (
                        <article aria-label="AI 导师" className="learn-ai" key={message.id}>
                          <AiContent markdown={message.markdown} />
                        </article>
                      ) : (
                        <UserMessageRow
                          key={message.id}
                          messageId={message.id}
                          text={message.markdown}
                          editing={editingMessageId === message.id}
                          editValue={editingMessageId === message.id ? editingDraft : undefined}
                          onEdit={
                            selectedIsActive && !supplementaryGenerating
                              ? () => {
                                  setEditingMessageId(message.id);
                                  setEditingDraft(message.markdown);
                                }
                              : undefined
                          }
                          onEditChange={setEditingDraft}
                          onEditCancel={() => {
                            setEditingMessageId(undefined);
                            setEditingDraft('');
                          }}
                          onEditSubmit={() => {
                            if (props.onReviseSupplementary === undefined) return;
                            setSupplementaryBusy(true);
                            void props.onReviseSupplementary(message.id, editingDraft).then(
                              () => {
                                setEditingMessageId(undefined);
                                setEditingDraft('');
                                setSupplementaryBusy(false);
                              },
                              () => {
                                setSupplementaryError('重新编辑失败，请重试。');
                                setSupplementaryBusy(false);
                              },
                            );
                          }}
                          editSubmitDisabled={supplementaryBusy}
                        />
                      ),
                    )}
                    {props.assistantMarkdown === undefined ||
                    props.assistantMarkdown === '' ? null : (
                      <article aria-label="补充学习助手 · 生成中" className="learn-ai">
                        <AiContent markdown={props.assistantMarkdown} />
                      </article>
                    )}
                    {supplementaryGenerating &&
                    (props.assistantMarkdown === undefined || props.assistantMarkdown === '') ? (
                      <p className="lesson-record-thinking" role="status">
                        正在思考中……
                      </p>
                    ) : null}
                  </ConversationStream>
                  {selectedIsActive && props.onSendSupplementary !== undefined ? (
                    <>
                      {!supplementaryRetryAvailable ? null : (
                        <button
                          aria-label="重新生成 AI 回复"
                          className="chat-user-action lesson-record-supplementary-retry"
                          disabled={supplementaryBusy || supplementaryGenerating}
                          title="重新生成 AI 回复"
                          type="button"
                          onClick={() => void props.onRetrySupplementary?.()}
                        >
                          <RetryIcon />
                        </button>
                      )}
                      {supplementaryGenerating && props.onStopSupplementary !== undefined ? (
                        <button
                          className="lm-btn lesson-record-stop-supplementary"
                          type="button"
                          onClick={() => void props.onStopSupplementary?.()}
                        >
                          停止生成
                        </button>
                      ) : null}
                      <ChatComposer
                        busy={supplementaryBusy || supplementaryGenerating}
                        error={supplementaryError}
                        label="补充学习输入"
                        placeholder="继续追问或补充你的思考…"
                        sendLabel="发送补充消息"
                        value={supplementaryInput}
                        onChange={setSupplementaryInput}
                        onSubmit={(markdown) => {
                          setSupplementaryBusy(true);
                          setSupplementaryError(undefined);
                          void props.onSendSupplementary!(selected.sessionId, markdown).then(
                            () => {
                              setSupplementaryInput('');
                              setSupplementaryBusy(false);
                            },
                            () => {
                              setSupplementaryError('补充消息发送失败，请重试。');
                              setSupplementaryBusy(false);
                            },
                          );
                        }}
                      />
                    </>
                  ) : null}
                </main>
              </div>
            </section>
          )}
        </section>
      </main>
    </div>
  );
}
