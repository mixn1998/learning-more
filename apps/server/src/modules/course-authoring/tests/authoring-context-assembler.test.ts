import { describe, expect, it } from 'vitest';

import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createAuthoringContextAssembler } from '../implementation/authoring-context-assembler.js';
import type { OutlineSessionRecord } from '../ports/outline-session-repository.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};

function session(input: {
  id: string;
  messages: OutlineSessionRecord['messages'];
  adjustmentCourseId?: string;
  historySessionIds?: readonly string[];
}): OutlineSessionRecord {
  return {
    resourceVersion: 0,
    candidateCommandReceipts: {},
    session: {
      outlineSessionId: input.id,
      courseMode: 'standard',
      topic: '微积分',
      state: 'assessment-ready',
      messageIds: input.messages.map((message) => message.messageId),
      completedAssessmentRounds: 3,
      candidateVersionIds: [],
      ...(input.adjustmentCourseId === undefined
        ? {}
        : { adjustmentCourseId: input.adjustmentCourseId }),
      ...(input.historySessionIds === undefined
        ? {}
        : { historySessionIds: input.historySessionIds }),
    },
    messages: input.messages,
  };
}

describe('createAuthoringContextAssembler', () => {
  it('builds a bounded past-version context from historical dialogue and completed lessons', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    await repositories.outlineSessions.save(
      tx,
      session({
        id: 'session_history',
        messages: [
          {
            messageId: 'message_history_user',
            role: 'user',
            content: '我想理解极限与导数，并保留极限基础模块。',
            status: 'complete',
            createdAt: '2026-07-20T00:00:00.000Z',
          },
          {
            messageId: 'message_history_assistant',
            role: 'assistant',
            content: '已确认课程先建立极限，再进入导数应用。',
            status: 'complete',
            createdAt: '2026-07-20T00:01:00.000Z',
          },
        ],
      }),
      0,
    );
    await repositories.outlineSessions.save(
      tx,
      session({
        id: 'session_adjustment',
        adjustmentCourseId: 'course_01',
        historySessionIds: ['session_history'],
        messages: [
          {
            messageId: 'message_current',
            role: 'user',
            content: '现在强化导数应用。',
            status: 'complete',
            createdAt: '2026-07-21T00:00:00.000Z',
          },
        ],
      }),
      0,
    );

    const assemble = createAuthoringContextAssembler(repositories, {
      listCompletedLessonOutlineContexts: async () => [
        {
          lessonId: 'lesson_limit',
          semanticKey: 'lesson_limit',
          title: '极限是什么',
          objective: '理解趋近过程',
          coreKnowledgePoints: ['趋近', '极限'],
        },
      ],
    });

    const context = await assemble('session_adjustment');

    expect(context.messages.map((message) => message.messageId)).toEqual(['message_current']);
    expect(context.pastVersionContext).toEqual({
      dialogueDigest: [
        '用户：我想理解极限与导数，并保留极限基础模块。',
        '助手：已确认课程先建立极限，再进入导数应用。',
      ].join('\n'),
      completedLessons: [
        {
          lessonId: 'lesson_limit',
          semanticKey: 'lesson_limit',
          title: '极限是什么',
          objective: '理解趋近过程',
          coreKnowledgePoints: ['趋近', '极限'],
        },
      ],
    });
  });
});
