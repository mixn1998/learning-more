import { AiContent, Badge, Stack } from '@learning-more/ui';

export type SessionMessageView = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt?: string | undefined;
}>;

export function MessageStream(props: {
  readonly messages?: readonly SessionMessageView[];
  readonly assistantMarkdown: string;
}) {
  const messages = props.messages ?? [];
  return (
    <section aria-live="polite" aria-label="学习对话" className="authoring-panel message-stream">
      {messages.length === 0 && props.assistantMarkdown === '' ? (
        <p className="lm-content-state">AI 导师的回复会显示在这里。</p>
      ) : (
        <Stack>
          {messages.map((message) => (
            <article className="session-message" data-role={message.role} key={message.id}>
              <Badge>{message.role === 'user' ? '你' : 'AI 导师'}</Badge>
              {message.role === 'assistant' ? (
                <AiContent markdown={message.markdown} />
              ) : (
                <p>{message.markdown}</p>
              )}
            </article>
          ))}
          {props.assistantMarkdown === '' ? null : (
            <article className="session-message" data-role="assistant">
              <Badge>AI 导师 · 生成中</Badge>
              <AiContent markdown={props.assistantMarkdown} />
            </article>
          )}
        </Stack>
      )}
    </section>
  );
}
