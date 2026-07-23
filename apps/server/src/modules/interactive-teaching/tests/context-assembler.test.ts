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
    async getPersonalizationView() {
      return {
        profileVersion: 2,
        purpose: 'interactive_teaching',
        courseId: 'course_1',
        lessonId: 'lesson_1',
        signals: [
          {
            evidenceId: 'evidence_1',
            summary: 'The learner previously requested concise examples. '.repeat(30),
            explicitness: 'ai_observed',
            sourceRefs: ['message:previous'],
            limitations: ['Observed once.'],
          },
        ],
        completeness: 'limited',
        sourceSnapshotHash: 'c'.repeat(64),
        createdAt: '2026-07-14T00:00:00.000Z',
      };
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
    expect(context.personalization.signals).toEqual([]);
  });

  it('keeps a bounded recent window plus unresolved source messages', async () => {
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
      'message_2',
      'message_9',
      'message_10',
      'message_11',
      'message_12',
    ]);
  });
});
