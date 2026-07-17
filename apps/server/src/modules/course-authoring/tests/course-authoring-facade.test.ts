import { describe, expect, it, vi } from 'vitest';

import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { RepositoryVersionConflictError } from '../../../persistence/repository-errors.js';
import { createCourseAuthoringFacade } from '../implementation/course-authoring-facade.js';
import { createInMemoryCourseCreationRepositories } from '../ports/course-repositories.js';
import type { OutlineSessionDraftStore } from '../ports/outline-session-draft-store.js';

const tx = {
  stageJson: async () => undefined,
  stageText: async () => undefined,
  deleteOnCommit: async () => undefined,
};
const unitOfWork = {
  async execute<T>(_request: unknown, work: (context: typeof tx) => Promise<T>) {
    return work(tx);
  },
};
const context = {
  commandId: 'command_01',
  correlationId: 'correlation_01',
  idempotencyKey: 'idem_01',
  actor: 'local-user' as const,
  requestedAt: '2026-07-13T00:00:00.000Z',
  receivedAt: '2026-07-13T00:00:00.000Z',
};
const queryContext = {
  correlationId: 'c',
  actor: 'local-user' as const,
  requestedAt: context.requestedAt,
  receivedAt: context.receivedAt,
};

function setup(
  options: {
    readonly outlineSessionDraftStore?: OutlineSessionDraftStore;
  } = {},
) {
  const authoring = createInMemoryCourseAuthoringRepositories();
  const courses = createInMemoryCourseCreationRepositories();
  let id = 0;
  let generationCalls = 0;
  const profileCheckpoints: unknown[] = [];
  const facade = createCourseAuthoringFacade({
    authoring,
    courses,
    unitOfWork,
    authoringAgent: {
      respond: async ({ completedAssessmentRounds }) =>
        `第 ${completedAssessmentRounds + 1} 轮澄清：请继续说明目标与边界。`,
    },
    candidateAlignmentPlanner: {
      plan: async () => ({ action: 'patch', rationale: 'contained change', targetModuleIds: [] }),
    },
    candidateGeneration: {
      recover: async () => undefined,
      generate: async () => {
        generationCalls += 1;
        return { taskId: 'task_01', state: 'running', resourceVersion: 7 };
      },
    },
    profileEvidenceSink: {
      capture(checkpoint) {
        profileCheckpoints.push(checkpoint);
      },
    },
    nextId: (kind) => `${kind}_${++id}`,
    now: () => new Date('2026-07-13T00:00:00.000Z'),
    ...(options.outlineSessionDraftStore === undefined
      ? {}
      : { outlineSessionDraftStore: options.outlineSessionDraftStore }),
  });
  return { authoring, courses, facade, generationCalls: () => generationCalls, profileCheckpoints };
}

describe('CourseAuthoring public facade', () => {
  it('creates an adjustment session from the current saved outline candidate', async () => {
    const { authoring, courses, facade } = setup();
    await authoring.candidateVersions.save(
      tx,
      {
        id: 'candidate_v1',
        outlineSessionId: 'original_session',
        generationTaskId: 'task_v1',
        draftArtifactRef: 'draft_v1',
        candidate: {
          outlineMarkdown: '# 微积分\n\n## 极限\n### 极限是什么',
          courseGoals: ['理解变化'],
          disciplineTag: '数学',
          topicTags: ['微积分'],
          modules: [{ id: 'module_limit', title: '极限', lessonIds: ['lesson_limit'] }],
          lessons: [
            {
              id: 'lesson_limit',
              title: '极限是什么',
              objective: '理解极限',
              coreKnowledgePoints: ['极限'],
              prerequisiteLessonIds: [],
              estimatedMinutes: 30,
              sourceRefs: ['source_topic'],
            },
          ],
        },
        createdAt: context.requestedAt,
        resourceVersion: 0,
      },
      0,
    );
    await courses.outlineVersions.save(
      tx,
      {
        id: 'outline_v1',
        courseId: 'course_1',
        sourceCandidateVersionId: 'candidate_v1',
        outlineMarkdown: '# 微积分\n\n## 极限\n### 极限是什么',
        disciplineTag: '数学',
        topicTags: ['微积分'],
        createdAt: context.requestedAt,
        resourceVersion: 0,
      },
      0,
    );
    await courses.courses.save(
      tx,
      {
        id: 'course_1',
        title: '我想系统学习从直观变化到严格推导的完整路径',
        courseMode: 'standard',
        outlineVersionId: 'outline_v1',
        lessonIds: [],
        status: 'active',
        createdAt: context.requestedAt,
        resourceVersion: 0,
      },
      0,
    );
    await authoring.outlineSessions.save(
      tx,
      {
        session: {
          outlineSessionId: 'original_session',
          courseMode: 'standard',
          topic: '微积分',
          state: 'confirmed',
          messageIds: ['origin_user', 'origin_assistant'],
          completedAssessmentRounds: 3,
          candidateVersionIds: ['candidate_v1'],
          latestCandidateVersionId: 'candidate_v1',
          confirmedCourseId: 'course_1',
        },
        resourceVersion: 0,
        candidateCommandReceipts: {},
        messages: [
          {
            messageId: 'origin_user',
            role: 'user',
            content: '我想系统学习微积分。',
            status: 'complete',
            createdAt: '2026-07-12T23:58:00.000Z',
          },
          {
            messageId: 'origin_assistant',
            role: 'assistant',
            content: '你希望投入多长时间？',
            status: 'complete',
            createdAt: '2026-07-12T23:59:00.000Z',
          },
        ],
      },
      0,
    );
    await authoring.outlineSessions.save(
      tx,
      {
        session: {
          outlineSessionId: 'legacy_adjustment_session',
          courseMode: 'standard',
          topic: '微积分',
          state: 'candidate-ready',
          messageIds: ['revision_user'],
          completedAssessmentRounds: 3,
          candidateVersionIds: ['candidate_v1'],
          latestCandidateVersionId: 'candidate_v1',
        },
        resourceVersion: 0,
        candidateCommandReceipts: {},
        messages: [
          {
            messageId: 'revision_user',
            role: 'user',
            content: '压缩为十八课核心版。',
            status: 'complete',
            createdAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      },
      0,
    );

    const created = await facade.execute(
      { type: 'CreateOutlineAdjustmentSession', courseId: 'course_1' },
      { ...context, expectedVersion: 1 },
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');
    const view = await facade.query(
      { type: 'GetOutlineSession', outlineSessionId: created.value.outlineSessionId },
      queryContext,
    );

    expect(created).toMatchObject({
      resourceVersion: 2,
      value: {
        outlineSessionId: 'legacy_adjustment_session',
        state: 'candidate-ready',
        completedAssessmentRounds: 3,
      },
    });
    expect(view).toMatchObject({
      topic: '微积分',
      candidateVersionId: 'candidate_v1',
      candidateMarkdown: '# 微积分\n\n## 极限\n### 极限是什么',
      messages: [
        { messageId: 'origin_user', content: '我想系统学习微积分。' },
        { messageId: 'origin_assistant', content: '你希望投入多长时间？' },
        { messageId: 'revision_user', content: '压缩为十八课核心版。' },
      ],
    });
    const reopened = await facade.execute(
      { type: 'CreateOutlineAdjustmentSession', courseId: 'course_1' },
      { ...context, commandId: 'command_02', expectedVersion: 1 },
    );
    expect(reopened).toMatchObject({
      resourceVersion: 2,
      value: { outlineSessionId: 'legacy_adjustment_session' },
    });
    await expect(facade.getCourse?.('course_1', queryContext)).resolves.toMatchObject({
      title: '微积分',
    });
  });

  it('permanently deletes an unconfirmed outline session at the expected version', async () => {
    const stageDelete = vi.fn(async () => ({
      outlineSessionId: 'session_1',
      deletedCounts: { outlineSessions: 1 },
    }));
    const { facade } = setup({ outlineSessionDraftStore: { stageDelete } });
    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: '待删除草稿', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');

    await expect(
      facade.execute(
        {
          type: 'DeleteOutlineSessionDraft',
          outlineSessionId: created.value.outlineSessionId,
        },
        { ...context, expectedVersion: created.resourceVersion },
      ),
    ).resolves.toMatchObject({
      resourceVersion: created.resourceVersion,
      value: {
        kind: 'outline-session-deleted',
        outlineSessionId: created.value.outlineSessionId,
        deletedAt: '2026-07-13T00:00:00.000Z',
      },
    });
    expect(stageDelete).toHaveBeenCalledWith(tx, created.value.outlineSessionId);
  });

  it('rejects deleting an outline session after it has become a formal course', async () => {
    const stageDelete = vi.fn();
    const { authoring, facade } = setup({ outlineSessionDraftStore: { stageDelete } });
    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: '已确认课程', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');
    const record = await authoring.outlineSessions.get(created.value.outlineSessionId);
    if (record === undefined) throw new Error('missing session');
    await authoring.outlineSessions.save(
      tx,
      {
        ...record,
        session: {
          ...record.session,
          state: 'confirmed',
          confirmedCourseId: 'course_01',
        },
      },
      record.resourceVersion,
    );

    await expect(
      facade.execute(
        {
          type: 'DeleteOutlineSessionDraft',
          outlineSessionId: created.value.outlineSessionId,
        },
        { ...context, expectedVersion: record.resourceVersion + 1 },
      ),
    ).rejects.toMatchObject({ code: 'outline_session_already_confirmed' });
    expect(stageDelete).not.toHaveBeenCalled();
  });

  it('stores the home topic as message one and the first AI reply as assessment round one', async () => {
    const { facade } = setup();

    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: ' token 会变成一种货币吗 ', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');
    expect(created).toMatchObject({
      outcome: 'completed',
      resourceVersion: 2,
      value: {
        kind: 'outline-session',
        state: 'assessing',
        completedAssessmentRounds: 1,
        canGenerateCandidate: false,
      },
    });

    const view = await facade.query(
      { type: 'GetOutlineSession', outlineSessionId: created.value.outlineSessionId },
      queryContext,
    );
    expect(view.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'token 会变成一种货币吗',
        status: 'complete',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: '第 1 轮澄清：请继续说明目标与边界。',
        status: 'complete',
      }),
    ]);
    expect(view.messages[1]?.inReplyToMessageId).toBe(view.messages[0]?.messageId);
  });

  it('blocks candidate generation before three rounds and keeps chat open afterward', async () => {
    const { facade, generationCalls, profileCheckpoints } = setup();
    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: 'probability', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');
    const outlineSessionId = created.value.outlineSessionId;

    await expect(
      facade.execute(
        { type: 'RequestCandidateGeneration', outlineSessionId },
        { ...context, commandId: 'command_blocked', expectedVersion: 2 },
      ),
    ).rejects.toMatchObject({ code: 'assessment_required' });
    expect(generationCalls()).toBe(0);

    const roundTwo = await facade.execute(
      { type: 'AppendOutlineSessionMessage', outlineSessionId, content: 'I know the basics.' },
      { ...context, commandId: 'command_02', expectedVersion: 2 },
    );
    expect(roundTwo).toMatchObject({
      resourceVersion: 4,
      value: { completedAssessmentRounds: 2, canGenerateCandidate: false },
    });
    const roundThree = await facade.execute(
      { type: 'AppendOutlineSessionMessage', outlineSessionId, content: 'I need decisions.' },
      { ...context, commandId: 'command_03', expectedVersion: 4 },
    );
    expect(roundThree).toMatchObject({
      resourceVersion: 6,
      value: {
        state: 'assessment-ready',
        completedAssessmentRounds: 3,
        canGenerateCandidate: true,
      },
    });
    expect(profileCheckpoints).toEqual([
      expect.objectContaining({
        checkpointKind: 'authoring_baseline',
        completeness: 'complete',
        sources: expect.arrayContaining([
          expect.objectContaining({ role: 'user', sourceRef: expect.stringMatching(/^message:/u) }),
        ]),
      }),
    ]);

    const roundFour = await facade.execute(
      { type: 'AppendOutlineSessionMessage', outlineSessionId, content: 'One more constraint.' },
      { ...context, commandId: 'command_04', expectedVersion: 6 },
    );
    expect(roundFour).toMatchObject({
      resourceVersion: 8,
      value: {
        state: 'assessment-ready',
        completedAssessmentRounds: 4,
        canGenerateCandidate: true,
      },
    });
    expect(profileCheckpoints).toHaveLength(1);
  });

  it('rejects stale expected versions before invoking generation', async () => {
    const { facade } = setup();
    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: 'probability', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');

    await expect(
      facade.execute(
        {
          type: 'RequestCandidateGeneration',
          outlineSessionId: created.value.outlineSessionId,
        },
        { ...context, commandId: 'command_02', expectedVersion: 0 },
      ),
    ).rejects.toBeInstanceOf(RepositoryVersionConflictError);
  });

  it('projects the active candidate task for reconnecting clients', async () => {
    const { authoring, facade } = setup();
    const created = await facade.execute(
      { type: 'CreateOutlineSession', topic: 'probability', courseMode: 'standard' },
      context,
    );
    if (created.value.kind !== 'outline-session') throw new Error('unexpected result');
    const record = await authoring.outlineSessions.get(created.value.outlineSessionId);
    if (record === undefined) throw new Error('missing session');
    await authoring.outlineSessions.save(
      tx,
      {
        ...record,
        session: {
          ...record.session,
          state: 'generating-candidates',
          activeCandidateTaskId: 'task_active',
        },
      },
      record.resourceVersion,
    );

    await expect(
      facade.query(
        { type: 'GetOutlineSession', outlineSessionId: created.value.outlineSessionId },
        queryContext,
      ),
    ).resolves.toMatchObject({
      state: 'generating-candidates',
      generationTaskId: 'task_active',
    });
  });
});
