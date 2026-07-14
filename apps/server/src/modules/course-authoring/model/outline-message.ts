export type OutlineMessage = Readonly<{
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'failed';
  createdAt: string;
  inReplyToMessageId?: string;
  alignmentAction?: 'clarify' | 'regenerate' | 'patch';
  targetModuleIds?: readonly string[];
}>;
