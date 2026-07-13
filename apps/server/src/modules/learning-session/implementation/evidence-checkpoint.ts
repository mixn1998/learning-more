export type EvidenceCheckpointInput = Readonly<{
  kind:
    | 'assistant_explanation'
    | 'assistant_answer'
    | 'user_answer'
    | 'user_knowledge_question'
    | 'navigation'
    | 'acknowledgement'
    | 'partial_output'
    | 'click'
    | 'elapsed_time';
  content?: string;
  complete?: boolean;
}>;

const acknowledgement = /^(好|好的|知道了|明白|ok|okay|yes|继续|下一步)[。.!！]?$/iu;

export function establishesEvidenceCheckpoint(input: EvidenceCheckpointInput): boolean {
  if (
    input.kind === 'navigation' ||
    input.kind === 'acknowledgement' ||
    input.kind === 'partial_output' ||
    input.kind === 'click' ||
    input.kind === 'elapsed_time' ||
    input.complete === false
  ) {
    return false;
  }
  const content = input.content?.replace(/\s+/gu, ' ').trim() ?? '';
  if (content === '' || acknowledgement.test(content)) return false;
  if (input.kind === 'user_knowledge_question') {
    return content.length >= 8 && /[?？]|(为什么|如何|什么|区别|关系|原理)/u.test(content);
  }
  if (input.kind === 'user_answer') return content.length >= 12;
  return content.length >= 20;
}

export function classifyUserLearningMessage(content: string): boolean {
  const question = /[?？]|(为什么|如何|什么|区别|关系|原理)/u.test(content);
  return establishesEvidenceCheckpoint({
    kind: question ? 'user_knowledge_question' : 'user_answer',
    content,
    complete: true,
  });
}
