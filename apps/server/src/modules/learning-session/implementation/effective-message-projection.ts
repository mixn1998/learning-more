type ConversationMessage = Readonly<{
  role: 'user' | 'assistant';
  markdown: string;
}>;

export function collapseRetryDuplicateUserMessages<T extends ConversationMessage>(
  messages: readonly T[],
): T[] {
  const effective: T[] = [];
  for (const message of messages) {
    const previous = effective.at(-1);
    if (
      message.role === 'user' &&
      previous?.role === 'user' &&
      message.markdown === previous.markdown
    ) {
      effective[effective.length - 1] = message;
      continue;
    }
    effective.push(message);
  }
  return effective;
}
