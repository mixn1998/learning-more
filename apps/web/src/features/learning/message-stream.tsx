import { AiContent } from '@learning-more/ui';

import { ConversationStream, UserMessageRow } from '../../components/chat/chat.js';

export type SessionMessageView = Readonly<{
  id: string;
  role: 'user' | 'assistant';
  markdown: string;
  createdAt?: string | undefined;
  completionStatus?: 'complete' | 'interrupted' | undefined;
}>;

export function MessageStream(props: {
  readonly messages?: readonly SessionMessageView[];
  readonly assistantMarkdown: string;
}) {
  const messages = props.messages ?? [];
  const followKey = `${messages.at(-1)?.id ?? 'empty'}:${props.assistantMarkdown.length}`;
  return (
    <ConversationStream
      as="section"
      className="authoring-panel message-stream"
      followKey={followKey}
      generating={props.assistantMarkdown !== ''}
      label="学习对话"
    >
      {messages.length === 0 && props.assistantMarkdown === '' ? (
        <p className="lm-content-state">AI 导师的回复会显示在这里。</p>
      ) : (
        <>
          {messages.map((message) =>
            message.role === 'assistant' ? (
              <article
                aria-label="AI 导师"
                className="session-message"
                data-role="assistant"
                key={message.id}
              >
                <AiContent markdown={message.markdown} />
              </article>
            ) : (
              <UserMessageRow key={message.id} messageId={message.id} text={message.markdown} />
            ),
          )}
          {props.assistantMarkdown === '' ? null : (
            <article
              aria-label="AI 导师 · 生成中"
              className="session-message"
              data-role="assistant"
            >
              <AiContent markdown={props.assistantMarkdown} />
            </article>
          )}
        </>
      )}
    </ConversationStream>
  );
}
