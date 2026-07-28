import { CandidateOutlineMetadataSchema } from './schemas/candidate-outline.js';
import type { CandidatePromptInput } from './prompt-input-builder.js';

const MAX_PAST_VERSION_CONTEXT_CHARS = 3_000;
const MAX_PAST_DIALOGUE_DIGEST_CHARS = 900;
const MAX_CURRENT_ADJUSTMENT_CONTEXT_CHARS = 5_000;
const MAX_ADJUSTMENT_TARGET_NAMES_CHARS = 500;

export const candidateOutlineOutputExample = {
  courseGoals: ['学习完成后能够解释并运用本课程的核心内容'],
  disciplineTag: '数学',
  topicTags: ['主题标签'],
  modules: [
    {
      id: 'module_foundation',
      title: '模块标题',
      lessonIds: ['lesson_foundation'],
    },
  ],
  lessons: [
    {
      id: 'lesson_foundation',
      title: '课节标题',
      objective: '本课节的学习目标',
      knowledgeStructure: {
        mainChain: [
          {
            id: 'node_question',
            content: '需要解决的核心问题',
            relationToNext: '问题促使我们建立',
          },
          {
            id: 'node_concept',
            content: '能够解释问题的关键概念',
          },
        ],
        branches: [
          {
            id: 'branch_boundary',
            attachedTo: 'node_concept',
            content: '概念成立的边界或常见误区',
            relation: '限定其适用范围',
          },
        ],
      },
      prerequisiteLessonIds: [],
      estimatedMinutes: 30,
      sourceRefs: ['source_topic'],
    },
  ],
} as const;

CandidateOutlineMetadataSchema.parse(candidateOutlineOutputExample);

const candidateModelResponseExample = {
  protocol: 'learning-more.candidate',
  schemaVersion: 1,
  outline: candidateOutlineOutputExample,
} as const;

function renderSources(sources: CandidatePromptInput['sources']): string {
  return sources
    .map(
      (source) =>
        `- Source reference: ${source.sourceRef}\n  Title: ${source.title}\n  Content: ${source.excerpt}`,
    )
    .join('\n');
}

function renderConversation(conversation: CandidatePromptInput['conversation']): string {
  if (conversation.length === 0) {
    return 'No new adjustment dialogue has occurred since the current candidate was created.';
  }
  return conversation
    .map((message) => `${message.role === 'user' ? 'LEARNER' : 'ASSISTANT'}:\n${message.content}`)
    .join('\n\n');
}

function compactPromptText(text: string, maxCharacters: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxCharacters) return trimmed;
  const normalized = trimmed.replace(/\s+/gu, ' ');
  const marker = ' … ';
  const available = maxCharacters - marker.length;
  const headLength = Math.ceil(available * 0.7);
  return `${normalized.slice(0, headLength)}${marker}${normalized.slice(
    normalized.length - (available - headLength),
  )}`;
}

function renderPastVersionContext(
  context: NonNullable<CandidatePromptInput['pastVersionContext']>,
) {
  const frozenLessons =
    context.frozenLessons.length === 0
      ? 'No lessons from a past version have been started.'
      : context.frozenLessons
          .map(
            (lesson) =>
              `- ${lesson.progress} | ${lesson.semanticKey} | ${compactPromptText(lesson.title, 80)}`,
          )
          .join('\n');
  const rendered = [
    'PART 1 — HISTORICAL AUTHORING DECISIONS',
    compactPromptText(
      context.dialogueDigest || 'No historical authoring dialogue is available.',
      MAX_PAST_DIALOGUE_DIGEST_CHARS,
    ),
    '',
    'PART 2 — FROZEN STARTED-LESSON ANCHORS',
    frozenLessons,
    '',
    'Every listed lesson has already been started. Use the current candidate as the authoritative source for its full title, objective, and knowledge structure. Keep each stable semantic key and learning status, and preserve the lesson exactly once. Do not rename, rewrite, replace, or duplicate it. Regenerate knowledge structures only for lessons that have not been started, around and after these frozen anchors.',
  ].join('\n');
  return compactPromptText(rendered, MAX_PAST_VERSION_CONTEXT_CHARS);
}

function renderAdjustmentTargets(input: CandidatePromptInput): string {
  const adjustment = input.requestedAdjustment;
  if (adjustment === undefined) {
    return 'Apply the latest unapplied learner instructions to the current candidate.';
  }
  if (adjustment.action !== 'patch') {
    return 'The learner requested a global restructuring. Rebuild the complete current candidate around the latest unapplied instructions.';
  }
  const nodes = input.currentCandidate?.outlineNodes ?? [];
  const targets = adjustment.targetModuleIds
    .map((ref) => nodes.find((node) => node.ref === ref))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  const targetNames = compactPromptText(
    targets.map((node) => node.title).join(', '),
    MAX_ADJUSTMENT_TARGET_NAMES_CHARS,
  );
  return [
    `The learner's requested change primarily concerns: ${targetNames || 'the complete current outline'}.`,
    'Preserve unrelated content where it remains coherent. You may make additional coherent adjustments when they genuinely improve the outline; the application will disclose those changes separately instead of rejecting the candidate.',
  ].join('\n\n');
}

function renderCurrentAdjustmentContext(input: CandidatePromptInput): string {
  const rendered = [
    'PART 1 — CURRENT CHANGE SCOPE',
    renderAdjustmentTargets(input),
    '',
    'PART 2 — UNAPPLIED ADJUSTMENT DIALOGUE',
    renderConversation(input.conversation),
  ].join('\n');
  return compactPromptText(rendered, MAX_CURRENT_ADJUSTMENT_CONTEXT_CHARS);
}

export function buildCandidateGenerationPrompt(input: CandidatePromptInput): string {
  return [
    'COURSE_OUTLINE_CANDIDATE_V4',
    '',
    '[MACHINE OUTPUT CONTRACT]',
    'This section defines interface syntax only. It does not constrain the teaching ideas, structure, tone, examples, or Markdown body.',
    'Return exactly one `learning-more-outline` fenced JSON block first, followed by a natural Markdown course outline.',
    'The JSON object must contain exactly the response envelope shown below. Replace example values with this course. Every lesson must appear in exactly one module. Use only source references listed below. Do not return session identifiers, course mode, topic, source permissions, task state, or other server context as output fields.',
    'disciplineTag must be one recognizable academic discipline or domain at the most specific stable level supported by the course, such as 数学、计算机科学、政治、经济、社会、心理、历史、法律、语言、艺术 or 商业与管理. Prefer a concrete discipline such as 政治 or 经济 over an umbrella label such as 社会科学 when the course clearly belongs to that discipline. Use a broader umbrella category only when the course genuinely spans multiple disciplines or cannot be classified reliably. Do not use a course title, learning path, or combined description as the disciplineTag.',
    'Topic tags are descriptive metadata rather than a fixed-size teaching format; preserve all relevant concepts you identify.',
    '```learning-more-outline',
    JSON.stringify(candidateModelResponseExample),
    '```',
    '',
    '[CONTENT FREEDOM]',
    'Compose the Markdown body freely around the learner’s real goal. Course mode is an attention preference, not a format prison. Course-adjacent exploration may be included when it supports the goal, but it must not masquerade as already completed core content.',
    'Within each lesson objective, design one intelligible main logic chain. Name every main-chain node as a learner-facing teaching knowledge point: use the shortest complete meaning that identifies the core cognition to be established and remains understandable outside the chain. A name may express a concept, relationship, criterion, insight, disagreement, or misconception correction at your discretion, but it must not be a bare graph label, a transition fragment, or a full explanation, argument, or case description. Tone examples only, not templates: `双侧极限的单侧判据`, `函数值与极限值的区别`, `无界不等于趋于无穷`, `基本定理连接变化与累积`. Put the reasoning between knowledge points in the free semantic text of `relationToNext`, rather than expanding the knowledge-point names. Each `relationToNext` must state the concrete inferential need, unresolved question, limitation, or new explanatory power that makes the next node necessary. Do not use generic placeholders such as `为下一步理解提供基础`; keep the relationship as unrestricted semantic text rather than introducing a relation taxonomy. Attach only necessary counterexamples, boundaries, or supporting concepts as branches of the relevant main node. Do not turn branches into separate progress steps, and do not use a node-type or relation-type taxonomy.',
    '',
    '[OUTLINE READABILITY]',
    'Start the Markdown body with exactly one level-1 course title, then one standalone paragraph in the form `**课程摘要：** 摘要内容`. The summary must contain 50–100 Chinese characters and concisely cover the learning target, core question, and expected outcome. Do not include scheduling, learning-cycle, weekly-investment, keyword, module, or lesson-list content in the summary.',
    'Help the learner scan the outline by making each module-to-lesson relationship explicit in the Markdown. For every lesson, make its objective, main logic chain, and necessary attached branches understandable. Keep the displayed lesson name consistent with the corresponding `outline.lessons[].title`.',
    'The knowledge chain is part of the confirmed outline and defines the teaching boundary. Its presentation is not fixed: choose the Markdown expression, wording, hierarchy depth, module count, lesson count, and teaching sequence that best fit the learner.',
    '',
    '[KNOWN LEARNING BACKGROUND]',
    `Course direction: ${input.courseDirection}`,
    `Learning approach: ${input.learningApproach}`,
    '',
    '[SOURCE MATERIALS]',
    renderSources(input.sources),
    '',
    ...(input.pastVersionContext === undefined
      ? ['', '[ORIGINAL CONVERSATION]', renderConversation(input.conversation)]
      : ['', '[PAST VERSION CONTEXT]', renderPastVersionContext(input.pastVersionContext)]),
    ...(input.currentCandidate === undefined
      ? []
      : ['', '[CURRENT CANDIDATE]', input.currentCandidate.markdown]),
    ...(input.pastVersionContext === undefined
      ? []
      : ['', '[CURRENT ADJUSTMENT CONTEXT]', renderCurrentAdjustmentContext(input)]),
  ].join('\n');
}
