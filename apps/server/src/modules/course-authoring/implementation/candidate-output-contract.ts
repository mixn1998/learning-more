import { CandidateOutlineMetadataSchema } from './schemas/candidate-outline.js';
import type { CandidatePromptInput } from './prompt-input-builder.js';

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
      coreKnowledgePoints: ['核心知识点'],
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
  return conversation
    .map((message) => `${message.role === 'user' ? 'LEARNER' : 'ASSISTANT'}:\n${message.content}`)
    .join('\n\n');
}

export function buildCandidateGenerationPrompt(input: CandidatePromptInput): string {
  const adjustment = input.requestedAdjustment;
  return [
    'COURSE_OUTLINE_CANDIDATE_V4',
    '',
    '[MACHINE OUTPUT CONTRACT]',
    'This section defines interface syntax only. It does not constrain the teaching ideas, structure, tone, examples, or Markdown body.',
    'Return exactly one `learning-more-outline` fenced JSON block first, followed by a natural Markdown course outline.',
    'The JSON object must contain exactly the response envelope shown below. Replace example values with this course. Every lesson must appear in exactly one module. Use only source references listed below. Do not return session identifiers, course mode, topic, source permissions, task state, or other server context as output fields.',
    'disciplineTag must be one broad academic or domain category, such as 数学、商业、计算机科学、语言、艺术 or 自然科学. Do not use a detailed course topic, subfield, learning path, or combined description.',
    'Topic tags are descriptive metadata rather than a fixed-size teaching format; preserve all relevant concepts you identify.',
    '```learning-more-outline',
    JSON.stringify(candidateModelResponseExample),
    '```',
    '',
    '[CONTENT FREEDOM]',
    'Compose the Markdown body freely around the learner’s real goal. Course mode is an attention preference, not a format prison. Course-adjacent exploration may be included when it supports the goal, but it must not masquerade as already completed core content.',
    '',
    '[OUTLINE READABILITY]',
    'Start the Markdown body with exactly one level-1 course title, then one standalone paragraph in the form `**课程摘要：** 摘要内容`. The summary must contain 50–100 Chinese characters and concisely cover the learning target, core question, and expected outcome. Do not include scheduling, learning-cycle, weekly-investment, keyword, module, or lesson-list content in the summary.',
    'Help the learner scan the outline by making each module-to-lesson relationship explicit in the Markdown. For every lesson, let the Markdown naturally answer three questions: What is the lesson name? What is its concise summary? What are its keywords or core knowledge points? Keep the displayed lesson name consistent with the corresponding `outline.lessons[].title`, and place the summary and keywords near that lesson heading.',
    'This is presentation guidance only: choose the module count, lesson count, teaching sequence, wording, hierarchy depth, and Markdown expression that best fit the learner. Do not force a fixed lesson template.',
    '',
    '[KNOWN LEARNING BACKGROUND]',
    `Course direction: ${input.courseDirection}`,
    `Learning approach: ${input.learningApproach}`,
    '',
    '[SOURCE MATERIALS]',
    renderSources(input.sources),
    '',
    '[ORIGINAL CONVERSATION]',
    renderConversation(input.conversation),
    ...(input.currentCandidate === undefined
      ? []
      : ['', '[CURRENT CANDIDATE]', input.currentCandidate.markdown]),
    ...(adjustment === undefined
      ? []
      : [
          '',
          '[CURRENT REQUEST]',
          adjustment.action === 'patch'
            ? `Update only these module ids: ${adjustment.targetModuleIds.join(', ')}. Preserve the remaining modules.`
            : 'Regenerate the complete outline from the full learning background and conversation.',
        ]),
  ].join('\n');
}
