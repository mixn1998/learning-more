import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import './chat.css';

export type MessageDeliveryStatus = 'submitting' | 'complete' | 'failed';

export type UserMessageBubbleProps = Readonly<{
  text: string;
  tone?: 'normal' | 'danger' | undefined;
}>;

export function UserMessageBubble(props: UserMessageBubbleProps) {
  return (
    <div className="chat-user-bubble" data-tone={props.tone ?? 'normal'}>
      {props.text}
    </div>
  );
}

export type UserMessageRowProps = Readonly<{
  messageId: string;
  text: string;
  status?: MessageDeliveryStatus | undefined;
  errorText?: string | undefined;
  timestamp?: string | undefined;
  onRetry?: (() => void) | undefined;
}>;

export function UserMessageRow(props: UserMessageRowProps) {
  const status = props.status ?? 'complete';
  const showMeta =
    status !== 'complete' || props.timestamp !== undefined || props.onRetry !== undefined;
  return (
    <article
      aria-label="你的消息"
      className="chat-user-row"
      data-message-id={props.messageId}
      data-message-status={status}
    >
      <UserMessageBubble text={props.text} tone={status === 'failed' ? 'danger' : 'normal'} />
      {showMeta ? (
        <footer className="chat-user-meta">
          {status === 'submitting' ? <span>正在发送…</span> : null}
          {status === 'failed' ? (
            <span aria-atomic="true" aria-live="polite">
              {props.errorText ?? '发送失败，内容已保留。'}
            </span>
          ) : null}
          {props.timestamp === undefined ? null : <time>{props.timestamp}</time>}
          {props.onRetry === undefined ? null : (
            <button type="button" onClick={props.onRetry}>
              重试
            </button>
          )}
        </footer>
      ) : null}
    </article>
  );
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref !== undefined && ref !== null) {
    (ref as { current: T | null }).current = value;
  }
}

export type ChatComposerProps = Readonly<{
  value: string;
  label: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  className?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  submitDisabled?: boolean | undefined;
  busy?: boolean | undefined;
  error?: string | undefined;
  maxLength?: number | undefined;
  sendLabel?: string | undefined;
  inputRef?: Ref<HTMLTextAreaElement> | undefined;
}>;

export function ChatComposer(props: ChatComposerProps) {
  const generatedId = useId();
  const inputId = `chat-composer-${generatedId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const canSubmit =
    props.value.trim() !== '' &&
    props.disabled !== true &&
    props.submitDisabled !== true &&
    props.busy !== true;
  const setInputRef = useCallback(
    (element: HTMLTextAreaElement | null) => {
      internalRef.current = element;
      assignRef(props.inputRef, element);
    },
    [props.inputRef],
  );

  useLayoutEffect(() => {
    const input = internalRef.current;
    if (input === null) return;
    input.style.height = '0px';
    if (input.scrollHeight === 0) {
      input.style.height = '48px';
      input.style.overflowY = 'hidden';
      return;
    }
    const nextHeight = Math.min(Math.max(input.scrollHeight, 48), 220);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [props.value]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    props.onSubmit(props.value.trim());
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form
      className={['chat-composer', props.className].filter(Boolean).join(' ')}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={inputId}>
        {props.label}
      </label>
      <div className="chat-composer__box">
        <textarea
          ref={setInputRef}
          aria-describedby={props.error === undefined ? hintId : `${hintId} ${errorId}`}
          aria-invalid={props.error === undefined ? undefined : true}
          disabled={props.disabled === true || props.busy === true}
          enterKeyHint="send"
          id={inputId}
          maxLength={props.maxLength}
          placeholder={props.placeholder}
          rows={2}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onKeyDown={keyDown}
        />
        <button
          aria-label={props.sendLabel ?? '发送'}
          className="chat-composer__send"
          disabled={!canSubmit}
          type="submit"
        >
          <span aria-hidden="true">{props.busy === true ? '…' : '↑'}</span>
        </button>
      </div>
      <div className="chat-composer__footer">
        <small id={hintId}>Enter 发送 · Shift+Enter 换行</small>
        {props.error === undefined ? null : (
          <small id={errorId} role="alert">
            {props.error}
          </small>
        )}
      </div>
    </form>
  );
}

export type ConversationStreamProps = Readonly<{
  children: ReactNode;
  label: string;
  followKey: string | number;
  forceFollowKey?: string | number | undefined;
  generating?: boolean | undefined;
  className?: string | undefined;
  as?: 'div' | 'main' | 'section' | undefined;
}>;

export function ConversationStream(props: ConversationStreamProps) {
  const Element = props.as ?? 'div';
  const streamRef = useRef<HTMLElement | null>(null);
  const nearBottomRef = useRef(true);
  const previousForceFollowKey = useRef(props.forceFollowKey);
  const previousGenerating = useRef(props.generating ?? false);
  const [hasNewContent, setHasNewContent] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const scrollToBottom = useCallback(() => {
    const stream = streamRef.current;
    if (stream === null) return;
    stream.scrollTop = stream.scrollHeight;
    nearBottomRef.current = true;
    setHasNewContent(false);
  }, []);

  useLayoutEffect(() => {
    const forceFollowChanged = previousForceFollowKey.current !== props.forceFollowKey;
    previousForceFollowKey.current = props.forceFollowKey;
    if (nearBottomRef.current || forceFollowChanged) {
      scrollToBottom();
    } else {
      setHasNewContent(true);
    }
  }, [props.followKey, props.forceFollowKey, scrollToBottom]);

  useLayoutEffect(() => {
    const generating = props.generating ?? false;
    if (generating === previousGenerating.current) return;
    setAnnouncement(generating ? 'AI 正在回复' : 'AI 回复完成');
    previousGenerating.current = generating;
  }, [props.generating]);

  return (
    <Element
      ref={(element) => {
        streamRef.current = element;
      }}
      aria-label={props.label}
      aria-live="off"
      className={['chat-conversation-stream', props.className].filter(Boolean).join(' ')}
      role="log"
      onScroll={(event) => {
        const stream = event.currentTarget;
        nearBottomRef.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight <= 80;
        if (nearBottomRef.current) setHasNewContent(false);
      }}
    >
      {props.children}
      {hasNewContent ? (
        <button className="chat-conversation-stream__jump" type="button" onClick={scrollToBottom}>
          回到最新消息
        </button>
      ) : null}
      {announcement === '' ? null : (
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {announcement}
        </span>
      )}
    </Element>
  );
}
