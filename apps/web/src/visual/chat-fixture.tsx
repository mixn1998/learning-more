import { useState } from 'react';

import { ChatComposer, ConversationStream, UserMessageRow } from '../components/chat/chat.js';

import './chat-fixture.css';

export function ChatFixture() {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState('');

  return (
    <main className="chat-fixture">
      <h1>统一用户消息与输入区</h1>
      <ConversationStream
        className="chat-fixture__stream"
        followKey={submitted}
        label="会话组件视觉验证"
      >
        <article aria-label="AI 导师" className="chat-fixture__assistant">
          请分别检查短文本、手动换行和超长连续文本。
        </article>
        <UserMessageRow messageId="short" text="好的" />
        <UserMessageRow messageId="three" text="继续吧" />
        <UserMessageRow messageId="multiline" text={'第一行\n第二行仍然完整显示'} />
        <UserMessageRow
          messageId="long"
          text="https://example.com/this-is-a-very-long-unbroken-value-that-must-wrap-without-overflow-1234567890"
        />
        <UserMessageRow
          errorText="发送失败，内容已保留。"
          messageId="failed"
          status="failed"
          text="请重试"
          onRetry={() => undefined}
        />
        {submitted === '' ? null : <UserMessageRow messageId="submitted" text={submitted} />}
      </ConversationStream>
      <ChatComposer
        label="会话输入"
        placeholder="输入消息…"
        sendLabel="发送消息"
        value={input}
        onChange={setInput}
        onSubmit={(text) => {
          setSubmitted(text);
          setInput('');
        }}
      />
    </main>
  );
}
