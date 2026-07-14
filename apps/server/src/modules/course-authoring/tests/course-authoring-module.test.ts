import { describe, expect, it, vi } from 'vitest';

import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createCourseAuthoringModule } from '../implementation/course-authoring-module.js';

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

function candidateMarkdown(title: string) {
  return `\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["掌握目标"],"disciplineTag":"数学","topicTags":["概率"],"modules":[{"id":"module_1","title":"${title}","lessonIds":["lesson_1"]}],"lessons":[{"id":"lesson_1","title":"${title}","objective":"理解概念","coreKnowledgePoints":["概念"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]}]}}
\`\`\`
# ${title}`;
}

describe('CourseAuthoringModule', () => {
  it('submits only one GenerationTask for repeated commandId', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    const submit = vi.fn().mockResolvedValue({ taskId: 'task_01' });
    const module = createCourseAuthoringModule({
      repositories,
      unitOfWork,
      generationRuntime: { submit },
      draftStore: { saveDraft: async () => undefined },
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_01',
      courseMode: 'standard',
      topic: '概率论',
      assessmentArtifactId: 'assessment_01',
    });

    const first = await module.requestCandidate({
      commandId: 'command_01',
      outlineSessionId: 'session_01',
      inputSnapshotHash: 'hash_01',
      promptInputArtifactRef: 'prompt-input:01',
    });
    const repeated = await module.requestCandidate({
      commandId: 'command_01',
      outlineSessionId: 'session_01',
      inputSnapshotHash: 'hash_01',
      promptInputArtifactRef: 'prompt-input:01',
    });

    expect(first).toEqual({ taskId: 'task_01' });
    expect(repeated).toEqual(first);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps an invalid generated draft and returns the session to a retryable state', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const module = createCourseAuthoringModule({
      repositories,
      unitOfWork,
      generationRuntime: { submit: async () => ({ taskId: 'task_invalid' }) },
      draftStore: { saveDraft },
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_invalid',
      courseMode: 'standard',
      topic: '概率论',
      assessmentArtifactId: 'a1',
    });
    await module.requestCandidate({
      commandId: 'command_invalid',
      outlineSessionId: 'session_invalid',
      inputSnapshotHash: 'h1',
      promptInputArtifactRef: 'prompt-input:invalid',
    });

    const result = await module.completeCandidate({
      outlineSessionId: 'session_invalid',
      generationTaskId: 'task_invalid',
      candidateVersionId: 'candidate_invalid',
      draftArtifactRef: 'draft_invalid',
      markdown: 'not a candidate',
      inputManifest: { draftArtifactRef: 'draft_invalid', sourceRefs: ['source_topic'] },
    });

    expect(result).toMatchObject({ valid: false });
    expect(saveDraft).toHaveBeenCalledWith('draft_invalid', 'not a candidate');
    await expect(repositories.outlineSessions.get('session_invalid')).resolves.toMatchObject({
      session: { state: 'assessment-ready' },
    });
    const versions = [];
    for await (const version of repositories.candidateVersions.listBySession('session_invalid'))
      versions.push(version);
    expect(versions).toHaveLength(0);
  });

  it('retains a Provider-interrupted partial draft without creating a candidate', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    const saveDraft = vi.fn().mockResolvedValue(undefined);
    const module = createCourseAuthoringModule({
      repositories,
      unitOfWork,
      generationRuntime: { submit: async () => ({ taskId: 'task_failed' }) },
      draftStore: { saveDraft },
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_failed',
      courseMode: 'standard',
      topic: '概率论',
      assessmentArtifactId: 'a1',
    });
    await module.requestCandidate({
      commandId: 'command_failed',
      outlineSessionId: 'session_failed',
      inputSnapshotHash: 'h',
      promptInputArtifactRef: 'prompt-input:failed',
    });

    await module.failCandidateGeneration({
      outlineSessionId: 'session_failed',
      generationTaskId: 'task_failed',
      draftArtifactRef: 'draft_failed',
      partialMarkdown: '# 已生成的部分',
    });

    expect(saveDraft).toHaveBeenCalledWith('draft_failed', '# 已生成的部分');
    await expect(repositories.outlineSessions.get('session_failed')).resolves.toMatchObject({
      session: { state: 'assessment-ready' },
    });
  });

  it('creates an immutable revision chain without rewriting its parent', async () => {
    const repositories = createInMemoryCourseAuthoringRepositories();
    let taskNumber = 0;
    const module = createCourseAuthoringModule({
      repositories,
      unitOfWork,
      generationRuntime: { submit: async () => ({ taskId: `task_${++taskNumber}` }) },
      draftStore: { saveDraft: async () => undefined },
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_versions',
      courseMode: 'standard',
      topic: '概率论',
      assessmentArtifactId: 'a1',
    });
    for (const version of [1, 2]) {
      const task = await module.requestCandidate({
        commandId: `command_${version}`,
        outlineSessionId: 'session_versions',
        inputSnapshotHash: `h${version}`,
        promptInputArtifactRef: `prompt-input:${version}`,
      });
      await module.completeCandidate({
        outlineSessionId: 'session_versions',
        generationTaskId: task.taskId,
        candidateVersionId: `candidate_v${version}`,
        draftArtifactRef: `draft_v${version}`,
        markdown: candidateMarkdown(`版本 ${version}`),
        inputManifest: { draftArtifactRef: `draft_v${version}`, sourceRefs: ['source_topic'] },
      });
    }

    const firstVersion = await repositories.candidateVersions.get('candidate_v1');
    expect(firstVersion?.parentVersionId).toBeUndefined();
    expect(firstVersion).toMatchObject({
      candidate: { lessons: [{ title: '版本 1' }] },
    });
    await expect(repositories.candidateVersions.get('candidate_v2')).resolves.toMatchObject({
      parentVersionId: 'candidate_v1',
      candidate: { lessons: [{ title: '版本 2' }] },
    });
  });
});
