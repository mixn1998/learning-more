import type { CourseMode } from '../model/commands.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';

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

export function buildCandidatePromptInput(context: AuthoringContext): CandidatePromptInput {
  return {
    courseDirection: context.topic,
    learningApproach: courseModeAttention[context.courseMode],
    conversation: context.messages
      .filter((message) => message.status === 'complete')
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
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
