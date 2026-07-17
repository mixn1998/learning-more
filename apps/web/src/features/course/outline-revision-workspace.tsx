import { useState } from 'react';

import type { CourseArchiveView, CourseOutlineVersionView } from '@learning-more/contracts';
import { AiContent, AiSurface, Button, Card, Dialog } from '@learning-more/ui';

import { ChatComposer, ConversationStream, UserMessageRow } from '../../components/chat/chat.js';
import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import type {
  OutlineChangeAttribution,
  OutlineChangeKind,
  OutlineMarkdownDiff,
  OutlineChangeStatus,
} from './outline-markdown-diff.js';
import '../course-authoring/outline-workspace-view.css';
import './outline-revision-workspace.css';

export type CourseRevisionMessage = Readonly<{
  role: 'user' | 'assistant';
  markdown: string;
}>;

export type CourseRevisionCandidate = Readonly<{
  candidateVersionId: string;
  title: string;
  markdown: string;
  versionLabel: string;
  diff: OutlineMarkdownDiff;
  impact: string;
}>;

const changeLabels: Readonly<Record<OutlineChangeStatus, string>> = {
  unchanged: '保持不变',
  modified: '内容调整',
  added: '新增',
  removed: '删除',
};

const changeKindLabels: Readonly<Record<OutlineChangeKind, string>> = {
  content: '内容变化',
  renamed: '重命名',
  moved: '移动',
};

const attributionLabels: Readonly<Record<OutlineChangeAttribution, string>> = {
  requested: '响应本次要求',
  ai_sync: 'AI 同步调整',
};

function ChangePreview(props: {
  readonly status: OutlineChangeStatus;
  readonly base?: Readonly<{ markdown: string }> | undefined;
  readonly candidate?: Readonly<{ markdown: string }> | undefined;
}) {
  if (props.status === 'unchanged') return null;
  const hasBefore = (props.base?.markdown.trim().length ?? 0) > 0;
  const hasAfter = (props.candidate?.markdown.trim().length ?? 0) > 0;
  if (!hasBefore && !hasAfter) return null;
  return (
    <details className="course-revision-diff__preview">
      <summary>查看前后内容</summary>
      <div className="course-revision-diff__preview-grid">
        {hasBefore ? (
          <section>
            <strong>修改前</strong>
            <AiContent markdown={props.base!.markdown} />
          </section>
        ) : null}
        {hasAfter ? (
          <section>
            <strong>修改后</strong>
            <AiContent markdown={props.candidate!.markdown} />
          </section>
        ) : null}
      </div>
    </details>
  );
}

export function OutlineRevisionWorkspace(props: {
  readonly course: CourseArchiveView;
  readonly currentOutline?: CourseOutlineVersionView | undefined;
  readonly initialMessages?: readonly CourseRevisionMessage[] | undefined;
  readonly candidate?: CourseRevisionCandidate | undefined;
  readonly busy?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onBack: () => void;
  readonly onPublish: (candidateVersionId: string) => Promise<void>;
  readonly onSend: (message: string) => Promise<void>;
}) {
  const [composer, setComposer] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  useCourseModeTheme(props.course.courseMode);
  const currentVersionNumber = Math.max(
    1,
    (props.course.outlineVersions ?? []).findIndex(
      (version) => version.outlineVersionId === props.course.outlineVersionId,
    ) + 1,
  );
  const nextVersionNumber = currentVersionNumber + 1;
  const visibleChangeCount =
    props.candidate === undefined
      ? 0
      : props.candidate.diff.courseSections.filter((section) => section.status !== 'unchanged')
          .length +
        props.candidate.diff.modules.reduce(
          (count, module) =>
            count +
            (module.status === 'unchanged' ? 0 : 1) +
            module.lessons.filter((lesson) => lesson.status !== 'unchanged').length,
          0,
        );

  const send = (message: string) => {
    if (props.busy === true) return;
    setComposer('');
    void props.onSend(message);
  };

  const messages = props.initialMessages ?? [];
  const lastMessage = messages.at(-1);
  const lastUserMessageIndex = messages.findLastIndex((message) => message.role === 'user');
  const followKey = `${messages.length}:${lastMessage?.markdown.length ?? 0}:${props.busy === true}`;

  const publish = () => {
    if (props.candidate === undefined || publishing) return;
    setPublishing(true);
    void props.onPublish(props.candidate.candidateVersionId).then(
      () => setPublishing(false),
      () => setPublishing(false),
    );
  };

  return (
    <main
      className="ow-page outline-workspace-view course-revision-page"
      data-course-mode={props.course.courseMode}
    >
      <Card className="ow-hero course-revision-hero">
        <div className="ow-hero-copy">
          <div className="lm-kicker">OUTLINE ADJUSTMENT</div>
          <h1>修改课程大纲</h1>
          <p>
            《{props.course.title}》· 当前{' '}
            {props.currentOutline?.current === false ? '历史版' : `v${currentVersionNumber}`}
          </p>
        </div>
        <div className="lm-actions">
          <Button type="button" onClick={props.onBack}>
            返回课程大纲
          </Button>
        </div>
      </Card>

      <div className="ow-workbench">
        <Card className="ow-panel ow-panel--conversation">
          <header className="ow-panel-head">
            <strong>大纲调整对话</strong>
            <span>继承起点评估、当前大纲和已完成 Review</span>
          </header>
          <ConversationStream
            className="ow-chat"
            followKey={followKey}
            forceFollowKey={lastUserMessageIndex < 0 ? undefined : lastUserMessageIndex}
            generating={props.busy}
            label="大纲调整对话"
          >
            {messages.map((message, index) =>
              message.role === 'user' ? (
                <UserMessageRow
                  key={`${index}-${message.markdown}`}
                  messageId={`revision-user-${index}`}
                  text={message.markdown}
                />
              ) : (
                <AiContent
                  key={`${index}-${message.markdown}`}
                  className="ow-ai"
                  markdown={message.markdown}
                />
              ),
            )}
            {props.busy === true ? (
              <p className="course-revision-busy" role="status">
                正在更新候选大纲…
              </p>
            ) : (
              <></>
            )}
            {props.error === undefined ? null : <p role="alert">{props.error}</p>}
          </ConversationStream>
          <ChatComposer
            className="ow-composer"
            busy={props.busy}
            label="继续说明希望怎样调整大纲"
            placeholder="继续说明希望怎样调整大纲……"
            sendLabel="发送调整要求"
            value={composer}
            onChange={setComposer}
            onSubmit={send}
          />
        </Card>

        <Card className="ow-panel ow-panel--outline">
          <header className="ow-panel-head">
            <strong>当前大纲与调整候选</strong>
            <span>{props.candidate?.versionLabel ?? '当前正式版本保持不变'}</span>
          </header>
          <AiSurface className="ow-outline course-revision-outlines">
            {props.candidate === undefined ? (
              <section className="course-revision-version course-revision-version--current">
                <div className="course-revision-version__head">
                  <div>
                    <div className="lm-kicker">CURRENT FORMAL OUTLINE</div>
                    <h2>当前正式大纲</h2>
                  </div>
                  <span className="lm-pill">调整前版本</span>
                </div>
                <AiContent
                  className="course-revision-markdown"
                  markdown={
                    props.currentOutline?.outlineMarkdown ??
                    props.course.outlineMarkdown ??
                    `# ${props.course.title}`
                  }
                />
              </section>
            ) : (
              <></>
            )}

            {props.candidate === undefined ? (
              <div className="course-revision-guidance">
                <p>
                  在左侧说明希望保留、删除、重排或强化的内容，候选版本会在这里与当前版并列显示。
                </p>
              </div>
            ) : (
              <>
                <section className="course-revision-version course-revision-version--candidate">
                  <div className="course-revision-version__head">
                    <div>
                      <div className="lm-kicker">CANDIDATE V{nextVersionNumber}</div>
                      <h2>{props.candidate.title}</h2>
                    </div>
                    <span className="lm-pill">尚未发布</span>
                  </div>
                  <AiContent
                    className="course-revision-markdown"
                    markdown={props.candidate.markdown}
                  />
                </section>

                <section aria-label="大纲版本差异" className="course-revision-diff">
                  <div className="course-revision-diff__head">
                    <h3>版本变化</h3>
                    <p>{props.candidate.impact}</p>
                  </div>
                  {visibleChangeCount === 0 ? (
                    <p className="course-revision-diff__empty">
                      没有检测到相对于当前版的可见变化。
                    </p>
                  ) : null}
                  {props.candidate.diff.courseSections.some(
                    (section) => section.status !== 'unchanged',
                  ) ? (
                    <section className="course-revision-diff__module">
                      <div className="course-revision-diff__row">
                        <strong>课程级内容变化</strong>
                      </div>
                      {props.candidate.diff.courseSections
                        .filter((section) => section.status !== 'unchanged')
                        .map((section) => (
                          <div key={section.key} className="course-revision-diff__lesson">
                            <div className="course-revision-diff__change-head">
                              <span>
                                {section.previousTitle === undefined
                                  ? section.title
                                  : `${section.previousTitle} → ${section.title}`}
                              </span>
                              <span className="course-revision-diff__badges">
                                {section.changeKinds.map((kind) => (
                                  <span key={kind} className="course-revision-change">
                                    {changeKindLabels[kind]}
                                  </span>
                                ))}
                                <span
                                  className={`course-revision-change course-revision-change--${section.status}`}
                                >
                                  {changeLabels[section.status]}
                                </span>
                                <span
                                  className={`course-revision-attribution course-revision-attribution--${section.attribution}`}
                                >
                                  {attributionLabels[section.attribution]}
                                </span>
                              </span>
                            </div>
                            <ChangePreview
                              base={section.base}
                              candidate={section.candidate}
                              status={section.status}
                            />
                          </div>
                        ))}
                    </section>
                  ) : null}
                  {props.candidate.diff.modules
                    .filter((module) => module.status !== 'unchanged')
                    .map((module) => (
                      <section key={module.key} className="course-revision-diff__module">
                        <div className="course-revision-diff__row">
                          <strong>
                            {module.previousTitle === undefined
                              ? module.title
                              : `${module.previousTitle} → ${module.title}`}
                          </strong>
                          <span className="course-revision-diff__badges">
                            {module.changeKinds.map((kind) => (
                              <span key={kind} className="course-revision-change">
                                {changeKindLabels[kind]}
                              </span>
                            ))}
                            <span
                              className={`course-revision-change course-revision-change--${module.status}`}
                            >
                              {changeLabels[module.status]}
                            </span>
                            <span
                              className={`course-revision-attribution course-revision-attribution--${module.attribution}`}
                            >
                              {attributionLabels[module.attribution]}
                            </span>
                          </span>
                        </div>
                        <ChangePreview
                          base={module.base}
                          candidate={module.candidate}
                          status={module.status}
                        />
                        {module.lessons
                          .filter((lesson) => lesson.status !== 'unchanged')
                          .map((lesson) => (
                            <div key={lesson.key} className="course-revision-diff__lesson">
                              <div className="course-revision-diff__change-head">
                                <span>
                                  {lesson.previousTitle === undefined
                                    ? lesson.title
                                    : `${lesson.previousTitle} → ${lesson.title}`}
                                </span>
                                <span className="course-revision-diff__badges">
                                  {lesson.changeKinds.map((kind) => (
                                    <span key={kind} className="course-revision-change">
                                      {changeKindLabels[kind]}
                                    </span>
                                  ))}
                                  <span
                                    className={`course-revision-change course-revision-change--${lesson.status}`}
                                  >
                                    {changeLabels[lesson.status]}
                                  </span>
                                  <span
                                    className={`course-revision-attribution course-revision-attribution--${lesson.attribution}`}
                                  >
                                    {attributionLabels[lesson.attribution]}
                                  </span>
                                </span>
                              </div>
                              <ChangePreview
                                base={lesson.base}
                                candidate={lesson.candidate}
                                status={lesson.status}
                              />
                            </div>
                          ))}
                      </section>
                    ))}
                </section>
              </>
            )}
          </AiSurface>
          <footer className="ow-footer">
            <span />
            <Button
              disabled={props.candidate === undefined}
              type="button"
              variant="primary"
              onClick={() => setConfirmOpen(true)}
            >
              确认并发布 v{nextVersionNumber}
            </Button>
          </footer>
        </Card>
      </div>

      <Dialog
        footer={
          <>
            <Button disabled={publishing} type="button" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button busy={publishing} type="button" variant="primary" onClick={publish}>
              {publishing ? '正在发布…' : '确认发布'}
            </Button>
          </>
        }
        onClose={() => {
          if (!publishing) setConfirmOpen(false);
        }}
        open={confirmOpen}
        title={`发布大纲 v${nextVersionNumber}？`}
      >
        <p>
          发布后 v{nextVersionNumber} 成为当前确认版；v{currentVersionNumber}
          与既有课节归档继续保留。
        </p>
      </Dialog>
    </main>
  );
}
