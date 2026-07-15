import type { ReactNode, Ref } from 'react';

import type { CourseMode } from '@learning-more/contracts';
import { AiContent, AiSurface, Button, Card } from '@learning-more/ui';

import { courseModeDefinition } from '../../course-mode-registry.js';
import { ChatComposer, ConversationStream, UserMessageRow } from '../../components/chat/chat.js';

import './outline-workspace-view.css';

export type OutlineWorkspaceLesson = Readonly<{
  title: string;
  points: readonly string[];
  source?: string | undefined;
}>;

export type OutlineWorkspaceModule = Readonly<{
  title: string;
  lessons: readonly OutlineWorkspaceLesson[];
}>;

export type OutlineWorkspaceMaterial = Readonly<{
  name: string;
  status: string;
  detail: string;
}>;

export type OutlineWorkspaceData = Readonly<{
  mode: CourseMode;
  topic: string;
  status: string;
  completedAssessmentRounds?: number;
  messages?: readonly Readonly<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'submitting' | 'complete' | 'failed';
  }>[];
  ai?: string;
  user?: string;
  follow?: string;
  outline: string;
  summary: string;
  candidateMarkdown?: string;
  discipline: string;
  tags: readonly string[];
  modules: readonly OutlineWorkspaceModule[];
  material?: OutlineWorkspaceMaterial | undefined;
}>;

export type OutlineWorkspaceViewProps = Readonly<{
  data: OutlineWorkspaceData;
  composerValue?: string | undefined;
  composerDisabled?: boolean | undefined;
  sendDisabled?: boolean | undefined;
  sendBusy?: boolean | undefined;
  assistantPending?: boolean | undefined;
  candidatePending?: boolean | undefined;
  generationCancelBusy?: boolean | undefined;
  turnError?: string | undefined;
  confirmBusy?: boolean | undefined;
  confirmDisabled?: boolean | undefined;
  composerLabel?: string | undefined;
  sendLabel?: string | undefined;
  secondaryLabel?: string | undefined;
  secondaryActionVisible?: boolean | undefined;
  primaryLabel?: string | undefined;
  primaryBusyLabel?: string | undefined;
  materialTools?: ReactNode | undefined;
  dangerAction?: ReactNode | undefined;
  composerRef?: Ref<HTMLTextAreaElement> | undefined;
  onComposerChange?: ((value: string) => void) | undefined;
  onSend?: (() => void) | undefined;
  onAdjust?: (() => void) | undefined;
  onConfirm?: (() => void) | undefined;
  onCancelGeneration?: (() => void) | undefined;
}>;

export function OutlineWorkspaceView(props: OutlineWorkspaceViewProps) {
  const { data } = props;
  const mode = courseModeDefinition(data.mode);
  const candidateMarkdown = data.candidateMarkdown?.trim() ?? '';
  const firstCandidateLine = candidateMarkdown.split(/\r?\n/).find((line) => line.trim() !== '');
  const candidateOwnsTitle = firstCandidateLine?.match(/^#{1,6}\s+/) !== null;
  const messages = data.messages ?? [
    ...(data.ai === undefined
      ? []
      : [
          {
            messageId: 'legacy-ai',
            role: 'assistant' as const,
            content: data.ai,
            status: 'complete' as const,
          },
        ]),
    ...(data.user === undefined
      ? []
      : [
          {
            messageId: 'legacy-user',
            role: 'user' as const,
            content: data.user,
            status: 'complete' as const,
          },
        ]),
    ...(data.follow === undefined
      ? []
      : [
          {
            messageId: 'legacy-follow',
            role: 'assistant' as const,
            content: data.follow,
            status: 'complete' as const,
          },
        ]),
  ];
  const completedAssessmentRounds =
    data.completedAssessmentRounds ?? (data.user === undefined ? 0 : 1);

  const lastMessage = messages.at(-1);
  const lastUserMessage = messages.findLast((message) => message.role === 'user');
  const followKey = `${messages.length}:${lastMessage?.messageId ?? 'opening'}:${lastMessage?.content.length ?? 0}:${props.assistantPending === true}`;

  return (
    <main className="ow-page outline-workspace-view" data-course-mode={data.mode}>
      <Card className="ow-hero">
        <div className="ow-hero-copy">
          <div className="lm-kicker">{mode.label.toUpperCase()}</div>
          <h1>{mode.label} · 学习档案创建</h1>
          <p>{mode.subtitle}</p>
        </div>
        <div aria-hidden="true" className="ow-hero-mark">
          {mode.icon}
        </div>
      </Card>

      <div aria-label="课程创建进度" className="ow-steps">
        <div className="ow-step">
          <b>01</b>提交主题
        </div>
        <div aria-current="step" className="ow-step active">
          <b>02</b>学习起点评估
        </div>
        <div className="ow-step">
          <b>03</b>候选大纲
        </div>
        <div className="ow-step">
          <b>04</b>确认课程
        </div>
      </div>

      {data.material === undefined && props.materialTools === undefined ? null : (
        <section className="ow-material">
          {data.material === undefined ? null : (
            <>
              <b>{data.material.name}</b>
              <br />
              {data.material.status} · {data.material.detail}
            </>
          )}
          {props.materialTools}
        </section>
      )}

      <div className="ow-workbench">
        <Card className="ow-panel ow-panel--conversation">
          <header className="ow-panel-head">
            <strong>学习起点评估</strong>
            <span>{data.status}</span>
          </header>
          <ConversationStream
            className="ow-chat"
            followKey={followKey}
            forceFollowKey={lastUserMessage?.messageId}
            generating={props.assistantPending}
            label="对话记录"
          >
            <AiContent
              className="ow-ai ow-opening-guidance"
              markdown="开始前，我会先了解你的学习目标与当前基础，再与你一起形成课程大纲。"
            />
            {messages.map((message) =>
              message.role === 'assistant' ? (
                <AiContent key={message.messageId} className="ow-ai" markdown={message.content} />
              ) : (
                <UserMessageRow
                  key={message.messageId}
                  errorText="发送失败 · 内容已恢复到输入框"
                  messageId={message.messageId}
                  status={message.status}
                  text={message.content}
                />
              ),
            )}
            {props.assistantPending ? (
              <div className="ow-ai ow-thinking" role="status">
                正在思考中<span aria-hidden="true">…</span>
              </div>
            ) : null}
            {props.turnError === undefined ? null : (
              <p className="ow-turn-error" role="alert">
                {props.turnError}
              </p>
            )}
            <p className="ow-round-status">
              {completedAssessmentRounds < 3
                ? `已完成 ${completedAssessmentRounds}/3 轮基础评估`
                : `已完成 ${completedAssessmentRounds} 轮对话，可生成候选大纲或继续澄清`}
            </p>
          </ConversationStream>
          <ChatComposer
            busy={props.sendBusy}
            className="ow-composer"
            disabled={props.composerDisabled}
            inputRef={props.composerRef}
            label={props.composerLabel ?? '继续回答或调整候选大纲'}
            placeholder="继续回答、纠正理解，或要求调整候选大纲……"
            sendLabel={props.sendLabel ?? '发送'}
            submitDisabled={props.sendDisabled}
            value={props.composerValue ?? ''}
            onChange={(value) => props.onComposerChange?.(value)}
            onSubmit={() => props.onSend?.()}
          />
          <footer className="ow-conversation-actions">
            {props.secondaryActionVisible === false ? null : (
              <Button type="button" onClick={props.onAdjust}>
                {props.secondaryLabel ?? '继续调整'}
              </Button>
            )}
            <Button
              busy={props.confirmBusy === true}
              disabled={props.confirmDisabled === true}
              type="button"
              variant="primary"
              onClick={props.onConfirm}
            >
              {props.confirmBusy
                ? (props.primaryBusyLabel ?? '正在创建…')
                : (props.primaryLabel ?? '生成候选大纲')}
            </Button>
          </footer>
        </Card>

        <Card className="ow-panel ow-panel--outline">
          <header className="ow-panel-head">
            <strong>候选大纲</strong>
            <span>完整 Markdown 快照 · 可继续对话调整</span>
          </header>
          {props.candidatePending ? (
            <div aria-label="候选大纲生成状态" className="ow-candidate-pending" role="status">
              <div className="ow-candidate-pending-copy">
                <span aria-hidden="true" className="ow-candidate-pending-indicator" />
                <span>
                  <strong>正在生成候选大纲</strong>
                  <small>AI 正在整理对话并组织课程结构，请稍候</small>
                </span>
              </div>
              <Button
                busy={props.generationCancelBusy === true}
                className="ow-candidate-cancel"
                disabled={props.generationCancelBusy === true}
                type="button"
                onClick={props.onCancelGeneration}
              >
                {props.generationCancelBusy ? '正在取消…' : '取消生成'}
              </Button>
            </div>
          ) : null}
          <AiSurface className="ow-outline">
            <div className="ow-outline-title">
              <div>
                <div className="lm-kicker">AI DRAFT</div>
                {candidateOwnsTitle ? null : <h2>{data.outline}</h2>}
                {candidateOwnsTitle ? null : <p>{data.summary}</p>}
              </div>
              <div className="lm-chips">
                <span className="lm-pill">{data.discipline}</span>
                {data.tags.map((tag) => (
                  <span key={tag} className="lm-pill">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {candidateMarkdown !== '' ? (
              <AiContent className="ow-outline-markdown" markdown={candidateMarkdown} />
            ) : (
              data.modules.map((module, moduleIndex) => (
                <section key={module.title} className="ow-module">
                  <div className="ow-module-head">
                    <strong>{`模块 ${moduleIndex + 1} · ${module.title}`}</strong>
                    <span>{`${moduleIndex + 1}/${data.modules.length}`}</span>
                  </div>
                  {module.lessons.map((lesson, lessonIndex) => (
                    <div key={lesson.title} className="ow-lesson">
                      <b>{`${moduleIndex + 1}.${lessonIndex + 1} ${lesson.title}`}</b>
                      {lesson.points.length === 0 ? null : <p>{lesson.points.join('、')}</p>}
                      {lesson.source === undefined ? null : (
                        <div className="ow-source">材料映射：{lesson.source}</div>
                      )}
                    </div>
                  ))}
                </section>
              ))
            )}
          </AiSurface>
          {props.dangerAction === undefined ? null : (
            <footer className="ow-footer">{props.dangerAction}</footer>
          )}
        </Card>
      </div>
    </main>
  );
}
