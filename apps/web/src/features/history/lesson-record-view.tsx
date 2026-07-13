import { useState } from 'react';

type SessionRecord = Readonly<{
  sessionId: string;
  label: string;
  messages: readonly string[];
}>;

export function LessonRecordView(props: {
  readonly original: SessionRecord;
  readonly supplementary: readonly SessionRecord[];
  readonly finalReviewMarkdown: string;
  readonly initialTab?: 'conversation' | 'review';
}) {
  const [topTab, setTopTab] = useState<'conversation' | 'review'>(
    props.initialTab ?? 'conversation',
  );
  const [sessionId, setSessionId] = useState(props.original.sessionId);
  const sessions = [props.original, ...props.supplementary];
  const selected = sessions.find((session) => session.sessionId === sessionId) ?? props.original;
  return (
    <section aria-label="课节记录">
      <nav role="tablist" aria-label="课节记录类型">
        <button
          type="button"
          role="tab"
          aria-selected={topTab === 'conversation'}
          onClick={() => setTopTab('conversation')}
        >
          学习对话
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={topTab === 'review'}
          onClick={() => setTopTab('review')}
        >
          课时 Review
        </button>
      </nav>
      {topTab === 'review' ? (
        <article aria-label="权威课时 Review">{props.finalReviewMarkdown}</article>
      ) : (
        <section aria-label="学习会话">
          <nav aria-label="会话时间线">
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => setSessionId(session.sessionId)}
              >
                {session.label}
              </button>
            ))}
          </nav>
          <article aria-label="只读学习对话">
            {selected.messages.map((message, index) => (
              <p key={`${selected.sessionId}:${index}`}>{message}</p>
            ))}
          </article>
        </section>
      )}
    </section>
  );
}
