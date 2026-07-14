import { useState } from 'react';

import type { CourseArchiveView, CourseOutlineVersionView } from '@learning-more/contracts';
import { AiContent, AiSurface, Button, Card, Dialog } from '@learning-more/ui';

import { useCourseModeTheme } from '../../use-course-mode-theme.js';
import '../course-authoring/outline-workspace-view.css';
import './outline-revision-workspace.css';

export type CourseRevisionMessage = Readonly<{
  role: 'user' | 'assistant';
  markdown: string;
}>;

export type CourseRevisionCandidate = Readonly<{
  candidateVersionId: string;
  title: string;
  summary: string;
  discipline: string;
  tags: readonly string[];
  versionLabel: string;
  modules: readonly Readonly<{
    title: string;
    change: string;
    lessons: readonly Readonly<{ title: string; detail: string }>[];
  }>[];
  impact: string;
}>;

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
            {props.currentOutline?.current === false ? '历史版' : 'v1'}
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
            <strong>调整候选大纲</strong>
            <span>{props.candidate?.versionLabel ?? '等待生成候选版本'}</span>
          </header>
          {props.candidate === undefined ? (
            <AiSurface className="ow-outline">
              <div className="course-revision-empty">
                <div className="lm-kicker">CURRENT OUTLINE</div>
                <h2>{props.course.title}</h2>
                <p>
                  在左侧说明调整目标，AI 会生成完整候选版本；当前确认版保持不变，直到你明确发布。
                </p>
              </div>
            </AiSurface>
          ) : (
            <AiSurface className="ow-outline">
              <div className="ow-outline-title">
                <div>
                  <div className="lm-kicker">CANDIDATE V2</div>
                  <h2>{props.candidate.title}</h2>
                  <p>{props.candidate.summary}</p>
                </div>
                <div className="lm-chips">
                  <span className="lm-pill">{props.candidate.discipline}</span>
                  {props.candidate.tags.map((tag) => (
                    <span key={tag} className="lm-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              {props.candidate.modules.map((module) => (
                <section key={module.title} className="ow-module">
                  <div className="ow-module-head">
                    <strong>{module.title}</strong>
                    <span>{module.change}</span>
                  </div>
                  {module.lessons.map((lesson, index) => (
                    <div key={lesson.title} className="ow-lesson">
                      <b>
                        {index + 1}. {lesson.title}
                      </b>
                      <p>{lesson.detail}</p>
                    </div>
                  ))}
                </section>
              ))}
              <div className="ow-note course-revision-impact">
                <b>版本影响：</b>
                {props.candidate.impact}
              </div>
            </AiSurface>
          )}
          <footer className="ow-footer">
            <span />
            <Button
              disabled={props.candidate === undefined}
              type="button"
              variant="primary"
              onClick={() => setConfirmOpen(true)}
            >
              确认并发布 v2
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
        title="发布大纲 v2？"
      >
        <p>发布后 v2 成为当前确认版；v1 与既有课节归档继续保留。</p>
      </Dialog>
    </main>
  );
}
