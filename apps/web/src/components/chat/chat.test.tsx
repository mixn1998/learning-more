// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer, ConversationStream, UserMessageRow } from './chat.js';

afterEach(cleanup);

describe('shared chat components', () => {
  it('keeps the bubble as the direct aligned child and preserves multiline plain text', () => {
    const text = ['好的', '继续'].join(String.fromCharCode(10));
    render(<UserMessageRow messageId="message_1" text={text} />);

    const row = screen.getByRole('article', { name: '你的消息' });
    const bubble = row.querySelector('.chat-user-bubble');
    expect(bubble).toBe(row.firstElementChild);
    expect(bubble).toHaveTextContent('好的 继续');
    expect(bubble).toHaveClass('chat-user-bubble');
  });

  it('edits inside the message row and exposes compact icon actions', () => {
    const onEditChange = vi.fn();
    const onEditSubmit = vi.fn();
    const onRetry = vi.fn();
    const { rerender } = render(
      <UserMessageRow
        messageId="message_1"
        onEdit={() => undefined}
        onRetry={onRetry}
        retryLabel="重新发送"
        text="原始消息"
      />,
    );

    expect(
      screen.getByRole('button', { name: '重新发送' }).querySelector('svg.chat-retry-icon'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: '重新编辑' })).toHaveTextContent('✎');

    rerender(
      <UserMessageRow
        editing
        editValue="原始消息"
        messageId="message_1"
        text="原始消息"
        onEditChange={onEditChange}
        onEditSubmit={onEditSubmit}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '编辑消息' }), {
      target: { value: '修改后的消息' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(onEditChange).toHaveBeenCalledWith('修改后的消息');
    expect(onEditSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables empty submission and submits trimmed text from Enter', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ChatComposer label="对话输入" value="" onChange={onChange} onSubmit={onSubmit} />,
    );

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    const multiline = ['第一行', '第二行'].join(String.fromCharCode(10));
    rerender(
      <ChatComposer
        label="对话输入"
        value={`  ${multiline}  `}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: '对话输入' }), {
      key: 'Enter',
      shiftKey: false,
    });
    expect(onSubmit).toHaveBeenCalledWith(multiline);
  });

  it('uses Shift+Enter for a newline and ignores Enter during IME composition', () => {
    const onSubmit = vi.fn();
    render(
      <ChatComposer label="对话输入" value="中文" onChange={() => undefined} onSubmit={onSubmit} />,
    );
    const input = screen.getByRole('textbox', { name: '对话输入' });

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('中文');
  });

  it('grows the composer until its maximum height', () => {
    const { rerender } = render(
      <ChatComposer
        label="对话输入"
        value="一行"
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    const input = screen.getByRole('textbox', { name: '对话输入' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 280 });
    rerender(
      <ChatComposer
        label="对话输入"
        value={Array.from({ length: 20 }, () => '一行').join(String.fromCharCode(10))}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(input).toHaveStyle({ height: '220px', overflowY: 'auto' });
  });

  it('preserves history position and offers a jump to new content', () => {
    const { rerender } = render(
      <ConversationStream followKey="1" label="对话记录">
        <p>第一条</p>
      </ConversationStream>,
    );
    const stream = screen.getByRole('log', { name: '对话记录' });
    Object.defineProperties(stream, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    stream.scrollTop = 100;
    fireEvent.scroll(stream);

    rerender(
      <ConversationStream followKey="2" label="对话记录">
        <p>第一条</p>
        <p>第二条</p>
      </ConversationStream>,
    );
    expect(screen.getByRole('button', { name: '回到最新消息' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '回到最新消息' }));
    expect(stream.scrollTop).toBe(500);
  });

  it('opens a conversation at its latest message', () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollHeight',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 500,
    });
    try {
      render(
        <ConversationStream followKey="session-1:3" label="conversation">
          <p>latest message</p>
        </ConversationStream>,
      );
      expect(screen.getByRole('log', { name: 'conversation' }).scrollTop).toBe(500);
    } finally {
      if (originalScrollHeight === undefined) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      } else {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      }
    }
  });

  it('follows the latest message when the active conversation changes', () => {
    const { rerender } = render(
      <ConversationStream followKey="session-1:2" forceFollowKey="session-1" label="conversation">
        <p>older message</p>
      </ConversationStream>,
    );
    const stream = screen.getByRole('log', { name: 'conversation' });
    Object.defineProperties(stream, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });
    stream.scrollTop = 100;
    fireEvent.scroll(stream);

    rerender(
      <ConversationStream followKey="session-2:4" forceFollowKey="session-2" label="conversation">
        <p>latest message</p>
      </ConversationStream>,
    );

    expect(stream.scrollTop).toBe(500);
    expect(screen.queryByRole('button', { name: '回到最新消息' })).not.toBeInTheDocument();
  });
});
