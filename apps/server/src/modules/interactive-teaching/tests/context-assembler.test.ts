import { describe, expect, it } from 'vitest';

import { createTeachingState } from '../implementation/teaching-state-reducer.js';
import { createTeachingContextAssembler } from '../implementation/context-assembler.js';
import type { TeachingContextSources } from '../ports/teaching-context-sources.js';

function sources(courseMode: 'standard' | 'case_study'): TeachingContextSources {
  return {
    async getCourseAndLesson() {
      return {
        course: {
          courseId: 'course_1',
          outlineVersionId: 'outline_1',
          title: 'Probability',
          courseMode,
          ...(courseMode === 'standard'
            ? {}
            : {
                playIntent:
                  'Learn through concrete situations, real constraints, mechanisms, and transfer boundaries when those opportunities are useful.',
              }),
          goals: ['Understand conditional probability.'],
          lessonMap: [
            {
              lessonId: 'lesson_1',
              title: 'Conditional probability',
              objective: 'Explain how conditioning changes the reference population.',
              relation: 'current',
            },
          ],
        },
        lesson: {
          lessonId: 'lesson_1',
          outlineVersionId: 'outline_1',
          title: 'Conditional probability',
          objective: 'Explain how conditioning changes the reference population.',
          coreKnowledgePoints: [
            { ref: 'knowledge:kp_1', text: 'Conditioning changes the sample space.' },
          ],
        },
      };
    },
    async listMessages() {
      return [
        {
          messageId: 'message_old',
          role: 'assistant',
          completionStatus: 'complete',
          markdown: 'An older explanation that can be trimmed. '.repeat(80),
          sourceRef: 'message:message_old',
        },
        {
          messageId: 'message_current',
          role: 'user',
          completionStatus: 'complete',
          markdown: 'Please explain this systematically before returning to the case.',
          sourceRef: 'message:message_current',
        },
      ];
    },
    async listRelevantFinalReviews() {
      return [
        {
          sourceRef: 'review:prior',
          version: '1',
          markdown: 'A distant review that can be trimmed. '.repeat(50),
          selectedBecause: 'Related prerequisite lesson.',
        },
      ];
    },
    async listRelevantMaterialExcerpts() {
      return [
        {
          sourceRef: 'material:case',
          version: '1',
          markdown: 'The case evidence and constraints.',
          selectedBecause: 'Mapped to the current lesson.',
        },
      ];
    },
    async getLearningStartSummary() {
      return 'The learner asked to build from concrete examples.';
    },
  };
}

function state() {
  return {
    ...createTeachingState({
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      knowledgePointRefs: ['knowledge:kp_1'],
    }),
    openLoops: [
      {
        entryId: 'open_1',
        summary: 'Return to why the denominator changes.',
        knowledgePointRefs: ['knowledge:kp_1'],
        sourceRefs: ['message:message_current'],
      },
    ],
  };
}

describe('TeachingContextAssembler', () => {
  it('keeps standard mode free of a synthetic play intent', async () => {
    const assembler = createTeachingContextAssembler({ sources: sources('standard') });
    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      currentUserMessageId: 'message_current',
      teachingState: state(),
      unobservedMessageIds: ['message_current'],
    });

    expect(context.course.courseMode).toBe('standard');
    expect(context.course).not.toHaveProperty('playIntent');
    expect(JSON.stringify(context)).not.toContain('modeWeight');
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(6_000);
  });

  it('assembles an opening turn without inventing a current learner message', async () => {
    const assembler = createTeachingContextAssembler({ sources: sources('standard') });
    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnKind: 'opening',
      teachingState: state(),
      unobservedMessageIds: [],
    });

    expect(context.turnKind).toBe('opening');
    expect(context.unobservedMessages).toEqual([]);
    expect(context.recentMessages).toHaveLength(2);
  });

  it('carries one advisory play intent without turning it into steps or quotas', async () => {
    const assembler = createTeachingContextAssembler({ sources: sources('case_study') });
    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      currentUserMessageId: 'message_current',
      teachingState: state(),
      unobservedMessageIds: [],
    });

    expect(context.course.playIntent).toContain('real constraints');
    expect(context.course.playIntent).not.toContain('must');
    expect(context).not.toHaveProperty('playSteps');
  });

  it('trims weak history while preserving current facts, lesson responsibility, and open loops', async () => {
    const assembler = createTeachingContextAssembler({
      sources: sources('case_study'),
      maxContextCharacters: 1_800,
    });
    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      currentUserMessageId: 'message_current',
      teachingState: state(),
      unobservedMessageIds: ['message_current'],
    });

    expect(context.recentMessages.map((message) => message.messageId)).toContain('message_current');
    expect(context.unobservedMessages.map((message) => message.messageId)).toEqual([
      'message_current',
    ]);
    expect(context.lesson.coreKnowledgePoints).toEqual([
      { ref: 'knowledge:kp_1', text: 'Conditioning changes the sample space.' },
    ]);
    expect(context.teachingState.openLoops).toHaveLength(1);
  });

  it('keeps a bounded recent window and carries older unresolved meaning through the ledger', async () => {
    const base = sources('standard');
    const messages = Array.from({ length: 12 }, (_, index) => ({
      messageId: `message_${index + 1}`,
      role: index % 2 === 0 ? ('assistant' as const) : ('user' as const),
      completionStatus: 'complete' as const,
      markdown: `Message ${index + 1}`,
      sourceRef: `message:message_${index + 1}`,
    }));
    const assembler = createTeachingContextAssembler({
      sources: {
        ...base,
        async listMessages() {
          return messages;
        },
      },
      maxRecentMessages: 4,
    });
    const teachingState = {
      ...state(),
      openLoops: [
        {
          entryId: 'open_old',
          summary: 'An unresolved early question.',
          knowledgePointRefs: ['knowledge:kp_1'],
          sourceRefs: ['message:message_2'],
        },
      ],
    };

    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      currentUserMessageId: 'message_12',
      teachingState,
      unobservedMessageIds: ['message_12'],
    });

    expect(context.recentMessages.map((message) => message.messageId)).toEqual([
      'message_9',
      'message_10',
      'message_11',
      'message_12',
    ]);
    expect(context.teachingState.openLoops[0]?.summary).toBe('An unresolved early question.');
  });

  it('keeps only the latest completed assistant reply as raw continuation history by default', async () => {
    const base = sources('standard');
    const assembler = createTeachingContextAssembler({
      sources: {
        ...base,
        async listMessages() {
          return [
            {
              messageId: 'message_previous_assistant',
              role: 'assistant' as const,
              completionStatus: 'complete' as const,
              markdown: 'Earlier teaching detail.',
              sourceRef: 'message:message_previous_assistant',
            },
            {
              messageId: 'message_latest_assistant',
              role: 'assistant' as const,
              completionStatus: 'complete' as const,
              markdown: 'The latest explanation that the next continuation must deepen.',
              sourceRef: 'message:message_latest_assistant',
            },
          ];
        },
      },
    });

    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnKind: 'continuation',
      teachingState: {
        ...state(),
        recentLearnerSignals: [
          {
            entryId: 'signal_1',
            summary: 'The learner can distinguish the two conditions but has not explained why.',
            explicitness: 'ai_observed',
            sourceRefs: ['message:message_previous_assistant'],
          },
        ],
      },
      unobservedMessageIds: [],
    });

    expect(context.recentMessages.map((message) => message.messageId)).toEqual([
      'message_latest_assistant',
    ]);
    expect(context.teachingState.recentLearnerSignals[0]?.summary).toContain(
      'has not explained why',
    );
  });

  it('keeps the latest completed assistant reply as the continuation anchor under budget pressure', async () => {
    const base = sources('standard');
    const assembler = createTeachingContextAssembler({
      sources: {
        ...base,
        async listMessages() {
          return [
            {
              messageId: 'message_previous_assistant',
              role: 'assistant' as const,
              completionStatus: 'complete' as const,
              markdown: 'Earlier teaching detail. '.repeat(80),
              sourceRef: 'message:message_previous_assistant',
            },
            {
              messageId: 'message_latest_assistant',
              role: 'assistant' as const,
              completionStatus: 'complete' as const,
              markdown: 'The latest explanation that the next continuation must deepen.',
              sourceRef: 'message:message_latest_assistant',
            },
          ];
        },
        async listRelevantMaterialExcerpts() {
          return [
            {
              sourceRef: 'material:primary',
              version: '1',
              markdown: 'Primary background. '.repeat(80),
              selectedBecause: 'Mapped to the current lesson.',
            },
            {
              sourceRef: 'material:secondary',
              version: '1',
              markdown: 'Secondary background. '.repeat(80),
              selectedBecause: 'Additional context.',
            },
          ];
        },
      },
      maxContextCharacters: 1_800,
      maxRecentMessages: 2,
    });

    const context = await assembler.assemble({
      courseId: 'course_1',
      lessonId: 'lesson_1',
      sessionId: 'session_1',
      turnKind: 'continuation',
      teachingState: state(),
      unobservedMessageIds: [],
    });

    expect(context.recentMessages.map((message) => message.messageId)).toContain(
      'message_latest_assistant',
    );
  });
});
