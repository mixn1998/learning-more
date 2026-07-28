import type { CourseMode } from '../model/commands.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';

const MAX_ADJUSTMENT_CONVERSATION_CHARS = 3_900;
const MAX_FIRST_USER_CHARS = 700;
const MAX_LATEST_USER_CHARS = 1_000;
const MAX_MIDDLE_USER_CHARS = 600;
const MAX_FIRST_ASSISTANT_CHARS = 300;
const MAX_LATEST_ASSISTANT_CHARS = 400;
const COMPACTION_MARKER = ' …[中间重复展开已压缩]… ';

const courseModeAttention: Readonly<Record<CourseMode, string>> = {
  standard: '以系统理解和稳固掌握为主要关注点，同时允许按学习需要切换解释方式。',
  brainstorm: '以发散联想和新可能为主要关注点，但不牺牲必要的知识结构与验证。',
  argument_clash: '以论点、反例和立场交锋为主要关注点，但不把所有内容强制改写成辩论。',
  case_study: '以真实情境和案例推演为主要关注点，但可随时进入系统解释、论证或决策分析。',
  business_insight: '以商业机制和行动含义为主要关注点，同时保留概念、证据与反例。',
  process_decomposition: '以过程、步骤和因果链拆解为主要关注点，但不限制跨步骤的整体理解。',
  decision_analysis: '以行为者选择、约束和权衡为主要关注点，同时允许补充概念与情境。',
  cross_explore: '以跨领域关联和迁移为主要关注点，并明确区分核心知识与邻接探索。',
  reading_seminar: '以材料细读、证据和文本问题为主要关注点，同时允许必要的背景解释与延伸。',
};

export type CandidatePromptInput = Readonly<{
  courseDirection: string;
  learningApproach: string;
  conversation: readonly Readonly<{
    role: 'user' | 'assistant';
    content: string;
  }>[];
  sources: readonly Readonly<{
    sourceRef: string;
    title: string;
    excerpt: string;
  }>[];
  pastVersionContext?: AuthoringContext['pastVersionContext'];
  currentCandidate?: Readonly<{
    markdown: string;
    outlineNodes?: NonNullable<AuthoringContext['candidate']>['outlineNodes'];
  }>;
  requestedAdjustment?: Readonly<{
    action: 'regenerate' | 'patch';
    targetModuleIds: readonly string[];
  }>;
}>;

type CandidateConversationMessage = CandidatePromptInput['conversation'][number];

function normalizeConversationContent(content: string): string {
  return content.replace(/\s+/gu, ' ').trim();
}

function compactContent(content: string, maxCharacters: number): string {
  const normalized = normalizeConversationContent(content);
  if (normalized.length <= maxCharacters) return normalized;
  const available = Math.max(0, maxCharacters - COMPACTION_MARKER.length);
  const headLength = Math.ceil(available * 0.7);
  return `${normalized.slice(0, headLength)}${COMPACTION_MARKER}${normalized.slice(
    normalized.length - (available - headLength),
  )}`;
}

function renderedConversationLength(messages: readonly CandidateConversationMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      message.content.length +
      (message.role === 'user' ? 'LEARNER:\n'.length : 'ASSISTANT:\n'.length) +
      2,
    0,
  );
}

function compactAdjustmentConversation(
  messages: AuthoringContext['messages'],
): readonly CandidateConversationMessage[] {
  const complete = messages
    .filter((message) => message.status === 'complete')
    .map((message, index) => ({
      index,
      role: message.role,
      content: message.content,
    }));
  const users = complete.filter((message) => message.role === 'user');
  const assistants = complete.filter((message) => message.role === 'assistant');
  if (users.length === 0) return [];

  const firstUser = users[0]!;
  const latestUser = users.at(-1)!;
  const firstAssistant = assistants[0];
  const latestAssistant = assistants.at(-1);
  const selected = new Map<
    number,
    Readonly<{ index: number; role: 'user' | 'assistant'; content: string }>
  >();
  const add = (
    message: Readonly<{ index: number; role: 'user' | 'assistant'; content: string }> | undefined,
    maxCharacters: number,
  ) => {
    if (message === undefined) return;
    selected.set(message.index, {
      ...message,
      content: compactContent(message.content, maxCharacters),
    });
  };

  add(firstUser, MAX_FIRST_USER_CHARS);
  add(latestUser, MAX_LATEST_USER_CHARS);
  add(firstAssistant, MAX_FIRST_ASSISTANT_CHARS);
  add(latestAssistant, MAX_LATEST_ASSISTANT_CHARS);

  for (const message of users.slice(1, -1).reverse()) {
    const compacted = {
      ...message,
      content: compactContent(message.content, MAX_MIDDLE_USER_CHARS),
    };
    const next = [...selected.values(), compacted]
      .sort((left, right) => left.index - right.index)
      .map(({ role, content }) => ({ role, content }));
    if (renderedConversationLength(next) > MAX_ADJUSTMENT_CONVERSATION_CHARS) continue;
    selected.set(message.index, compacted);
  }

  return [...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ role, content }) => ({ role, content }));
}

export function buildCandidatePromptInput(context: AuthoringContext): CandidatePromptInput {
  const candidateCreatedAt = context.candidate?.createdAt;
  const unappliedAdjustmentMessages =
    candidateCreatedAt === undefined
      ? context.messages
      : context.messages.filter((message) => message.createdAt > candidateCreatedAt);
  return {
    courseDirection: context.topic,
    learningApproach: courseModeAttention[context.courseMode],
    conversation:
      context.pastVersionContext === undefined
        ? context.messages
            .filter((message) => message.status === 'complete')
            .map((message) => ({
              role: message.role,
              content: message.content,
            }))
        : compactAdjustmentConversation(unappliedAdjustmentMessages),
    sources: [
      { sourceRef: 'source_topic', title: 'Initial course direction', excerpt: context.topic },
      ...context.materials,
    ],
    ...(context.pastVersionContext === undefined
      ? {}
      : { pastVersionContext: context.pastVersionContext }),
    ...(context.candidate === undefined
      ? {}
      : {
          currentCandidate: {
            markdown: context.candidate.markdown,
            ...(context.candidate.outlineNodes === undefined
              ? {}
              : { outlineNodes: context.candidate.outlineNodes }),
          },
        }),
    ...(context.pendingAlignment === undefined
      ? {}
      : { requestedAdjustment: context.pendingAlignment }),
  };
}
