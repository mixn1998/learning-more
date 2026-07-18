import { useState } from 'react';

import type { AiSurfaceContent } from '@learning-more/ui';
import { AiContent, AiSurface, tabId, tabPanelId, Tabs } from '@learning-more/ui';
import type { ReviewDocument } from '@learning-more/contracts';

import { ChatComposer, ConversationStream, UserMessageRow } from '../../components/chat/chat.js';
import {
  LessonFinalReviewDocumentView,
  LessonStageReviewDocumentView,
} from '../review/review-document-view.js';

import './lesson-record-view.css';

type SessionRecord = Readonly<{
  sessionId: string;
  label: string;
  messages: readonly Readonly<{
    id: string;
    role: 'user' | 'assistant';
    markdown: string;
  }>[];
  meta?: string;
}>;

const lessonRecordTabs = [
  { id: 'conversation', label: '学习对话' },
  { id: 'review', label: '课时 Review' },
] as const;

const lessonRecordTabsIdPrefix = 'lesson-record-content';

function ReadonlyMessage(props: { readonly message: SessionRecord['messages'][number] }) {
  return props.message.role === 'assistant' ? (
    <article aria-label="AI 导师" className="learn-ai">
      <AiContent markdown={props.message.markdown} />
    </article>
  ) : (
    <UserMessageRow messageId={props.message.id} text={props.message.markdown} />
  );
}

function durationLabel(seconds: number | undefined) {
  if (seconds === undefined) return '时长已归档';
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}

export function LessonRecordView(props: {
  readonly original: SessionRecord;
  readonly supplementary: readonly SessionRecord[];
  readonly finalReviewMarkdown?: string;
  readonly progress?: 'in_progress' | 'abandoned' | 'completed';
  readonly reviewStatus?: 'generating' | 'failed' | 'ready';
  readonly initialTab?: 'conversation' | 'review';
  readonly title?: string;
  readonly courseTitle?: string;
  readonly completedAt?: string;
  readonly actualSeconds?: number;
  readonly reviewContent?: AiSurfaceContent;
  readonly reviewDocument?: ReviewDocument;
  readonly onBackHome?: () => void;
  readonly onBackToOutline?: () => void;
  readonly onStartSupplementary?: (() => Promise<{ sessionId: string }>) | undefined;
  readonly onSendSupplementary?:
    ((sessionId: string, markdown: string) => Promise<void>) | undefined;
}) {
  const [topTab, setTopTab] = useState<'conversation' | 'review'>(
    props.initialTab ?? 'conversation',
  );
  const [sessionId, setSessionId] = useState(props.original.sessionId);
  const [supplementaryInput, setSupplementaryInput] = useState('');
  const [supplementaryBusy, setSupplementaryBusy] = useState(false);
  const [supplementaryError, setSupplementaryError] = useState<string>();
  const sessions = [props.original, ...props.supplementary];
  const selected = sessions.find((session) => session.sessionId === sessionId) ?? props.original;
  const date = props.completedAt ?? '完成时间已归档';
  const duration = durationLabel(props.actualSeconds);
  const progressLabel = props.progress === 'abandoned' ? '已结束' : '已完成';
  return (
    <div className="lesson-record-workspace">
      <header className="lm-topbar lesson-record-topbar">
        <div className="lm-brand">
          <strong>Learning MORE</strong>
          <span>只读课节记录</span>
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
                  <LessonFinalReviewDocumentView document={props.reviewDocument} />
                ) : props.reviewDocument?.kind === 'lesson-stage' ? (
                  <LessonStageReviewDocumentView document={props.reviewDocument} />
                ) : props.reviewContent !== undefined ? (
                  <AiSurface className="review-content">{props.reviewContent}</AiSurface>
                ) : props.finalReviewMarkdown !== undefined ? (
                  <AiContent className="review-content" markdown={props.finalReviewMarkdown} />
                ) : props.reviewStatus === 'failed' ? (
                  <p role="alert">阶段性 Review 生成失败；课节对话已经完整归档。</p>
                ) : (
                  <p role="status">阶段性 Review 正在生成中，可稍后返回课程页面查看。</p>
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
                  {sessions.map((session, index) => (
                    <button
                      aria-label={session.label}
                      className={`lesson-record-session ${session.sessionId === selected.sessionId ? 'active' : ''}`}
                      key={session.sessionId}
                      type="button"
                      onClick={() => setSessionId(session.sessionId)}
                    >
                      <b>{session.label}</b>
                      <span>
                        {session.meta ??
                          (index === 0 ? `${date} · ${duration}` : '独立补充学习归档')}
                      </span>
                    </button>
                  ))}
                  {props.progress === 'completed' && props.onStartSupplementary !== undefined ? (
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
                    followKey={`${selected.sessionId}:${selected.messages.length}`}
                    label="只读学习对话"
                  >
                    {selected.messages.map((message) => (
                      <ReadonlyMessage key={message.id} message={message} />
                    ))}
                  </ConversationStream>
                  {selected.sessionId !== props.original.sessionId &&
                  props.onSendSupplementary !== undefined ? (
                    <ChatComposer
                      busy={supplementaryBusy}
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
