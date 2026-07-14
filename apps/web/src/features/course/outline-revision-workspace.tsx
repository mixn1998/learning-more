import { useState } from 'react';

import type { CourseArchiveView, CourseOutlineVersionView } from '@learning-more/contracts';
import { AiContent, AiSurface, Button, Card, Dialog } from '@learning-more/ui';

import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import type { OutlineMarkdownDiff, OutlineChangeStatus } from './outline-markdown-diff.js';
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

  const send = () => {
    const message = composer.trim();
    if (message === '' || props.busy === true) return;
    setComposer('');
    void props.onSend(message);
  };

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
        <Card className="ow-panel">
          <header className="ow-panel-head">
            <strong>大纲调整对话</strong>
            <span>继承起点评估、当前大纲和已完成 Review</span>
          </header>
          <div aria-live="polite" className="ow-chat">
            {(props.initialMessages ?? []).map((message, index) =>
              message.role === 'user' ? (
                <div key={`${index}-${message.markdown}`} className="ow-user">
                  <div className="ow-bubble">{message.markdown}</div>
                </div>
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
            ) : null}
            {props.error === undefined ? null : <p role="alert">{props.error}</p>}
          </div>
          <form
            className="ow-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <div className="ow-composer-box">
              <textarea
                aria-label="继续说明希望怎样调整大纲"
                disabled={props.busy === true}
                placeholder="继续说明希望怎样调整大纲……"
                value={composer}
                onChange={(event) => setComposer(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button
                aria-label="发送调整要求"
                className="ow-send"
                disabled={props.busy === true || composer.trim() === ''}
                type="submit"
              >
                {props.busy === true ? '…' : '↑'}
              </button>
            </div>
          </form>
        </Card>

        <Card className="ow-panel">
          <header className="ow-panel-head">
            <strong>当前大纲与调整候选</strong>
            <span>{props.candidate?.versionLabel ?? '当前正式版本保持不变'}</span>
          </header>
          <AiSurface className="ow-outline course-revision-outlines">
            <section className="course-revision-version course-revision-version--current">
              <div className="course-revision-version__head">
                <div>
                  <div className="lm-kicker">CURRENT FORMAL OUTLINE</div>
                  <h2>当前正式大纲</h2>
                </div>
                <span className="lm-pill">发布前保持不变</span>
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
                  {props.candidate.diff.modules.map((module) => (
                    <section key={module.key} className="course-revision-diff__module">
                      <div className="course-revision-diff__row">
                        <strong>{module.title}</strong>
                        <span
                          className={`course-revision-change course-revision-change--${module.status}`}
                        >
                          {changeLabels[module.status]}
                        </span>
                      </div>
                      {module.lessons.map((lesson) => (
                        <div key={lesson.key} className="course-revision-diff__lesson">
                          <span>{lesson.title}</span>
                          <span
                            className={`course-revision-change course-revision-change--${lesson.status}`}
                          >
                            {changeLabels[lesson.status]}
                          </span>
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
