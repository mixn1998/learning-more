import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import { createApiProvider } from '../../../ai-providers/api-provider.js';
import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createInMemoryRepositories } from '../../../persistence/in-memory-repositories.js';
import { DataRoot } from '../../../persistence/data-root.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { createGenerationFrameLog } from '../../generation-runtime/implementation/frame-log.js';
import { createGenerationExecution } from '../../generation-runtime/implementation/generation-execution.js';
import { createGenerationRuntime } from '../../generation-runtime/implementation/generation-runtime.js';
import { createCandidateGenerationCoordinator } from '../implementation/candidate-generation-coordinator.js';
import { createCourseAuthoringModule } from '../implementation/course-authoring-module.js';

const roots: string[] = [];
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
const markdown = `\`\`\`learning-more-outline
{"protocol":"learning-more.candidate","schemaVersion":1,"outline":{"courseGoals":["Understand probability"],"disciplineTag":"mathematics","topicTags":["probability"],"modules":[{"id":"module_probability","title":"Probability foundations","lessonIds":["probability-space","random-variable"]}],"lessons":[{"id":"probability-space","title":"Probability spaces","objective":"Understand sample spaces","coreKnowledgePoints":["sample space"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]},{"id":"random-variable","title":"Random variables","objective":"Model outcomes","coreKnowledgePoints":["random variable"],"prerequisiteLessonIds":["probability-space"],"estimatedMinutes":45,"sourceRefs":["source_topic"]}]}}
\`\`\`
# Probability course`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('candidate generation coordinator', () => {
  it('runs the Mock Provider, saves an immutable candidate, and publishes replayable frames', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-candidate-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const authoring = createInMemoryCourseAuthoringRepositories();
    const generationTasks = createInMemoryRepositories().generationTasks;
    const runtime = createGenerationRuntime({
      repository: generationTasks,
      unitOfWork,
      providers: [createMockProvider({ id: 'mock', script: [{ type: 'text', text: markdown }] })],
      nextId: () => 'task_01',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const module = createCourseAuthoringModule({
      repositories: authoring,
      unitOfWork,
      generationRuntime: runtime,
      providerId: 'mock',
      draftStore: { saveDraft: async () => undefined },
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_01',
      courseMode: 'standard',
      topic: 'probability',
      assessmentArtifactId: 'assessment_01',
    });
    const frameLog = createGenerationFrameLog(dataRoot);
    const background: Array<() => Promise<void>> = [];
    const coordinator = createCandidateGenerationCoordinator({
      module,
      repositories: authoring,
      runtime,
      execution: createGenerationExecution({ runtime, frameLog }),
      frameLog,
      nextCandidateId: () => 'candidate_01',
      dispatchBackground: (work) => background.push(work),
    });

    const result = await coordinator.generate({
      commandId: 'command_01',
      outlineSessionId: 'session_01',
    });

    expect(result).toMatchObject({ taskId: 'task_01', state: 'running', resourceVersion: 2 });
    await expect(authoring.candidateVersions.get('candidate_01')).resolves.toBeUndefined();
    expect(background).toHaveLength(1);

    await background[0]!();

    await expect(authoring.candidateVersions.get('candidate_01')).resolves.toMatchObject({
      candidate: { lessons: [{ id: 'probability-space' }, { id: 'random-variable' }] },
    });
    const replay = await frameLog.readAfter('task_01', 0);
    expect(replay.frames.map((frame) => frame.type)).toEqual([
      'message.started',
      'message.delta',
      'message.completed',
      'artifact.ready',
      'task.completed',
    ]);
  });

  it('finishes the authoring projection when recovery finds a completed generation task', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-candidate-recovery-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const authoring = createInMemoryCourseAuthoringRepositories();
    const runtime = createGenerationRuntime({
      repository: createInMemoryRepositories().generationTasks,
      unitOfWork,
      providers: [createMockProvider({ id: 'mock', script: [{ type: 'text', text: markdown }] })],
      nextId: () => 'task_recovery',
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    const module = createCourseAuthoringModule({
      repositories: authoring,
      unitOfWork,
      generationRuntime: runtime,
      providerId: 'mock',
      draftStore: { saveDraft: async () => undefined },
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_recovery',
      courseMode: 'standard',
      topic: 'probability',
      assessmentArtifactId: 'assessment_recovery',
    });
    const frameLog = createGenerationFrameLog(dataRoot);
    const execution = createGenerationExecution({ runtime, frameLog });
    const abandonedWork: Array<() => Promise<void>> = [];
    const beforeRestart = createCandidateGenerationCoordinator({
      module,
      repositories: authoring,
      runtime,
      execution,
      frameLog,
      nextCandidateId: () => 'candidate_abandoned',
      dispatchBackground: (work) => abandonedWork.push(work),
    });
    await beforeRestart.generate({
      commandId: 'command_recovery',
      outlineSessionId: 'session_recovery',
    });
    await runtime.runNext();

    const afterRestart = createCandidateGenerationCoordinator({
      module,
      repositories: authoring,
      runtime,
      execution,
      frameLog,
      nextCandidateId: () => 'candidate_recovered',
    });
    await afterRestart.recover({
      outlineSessionId: 'session_recovery',
      taskId: 'task_recovery',
    });

    expect(abandonedWork).toHaveLength(1);
    await expect(authoring.candidateVersions.get('candidate_recovered')).resolves.toBeDefined();
    await expect(authoring.outlineSessions.get('session_recovery')).resolves.toMatchObject({
      session: { state: 'candidate-ready', latestCandidateVersionId: 'candidate_recovered' },
    });
    await expect(frameLog.readAfter('task_recovery', 0)).resolves.toMatchObject({
      meta: { state: 'completed' },
    });
  });

  it('replays a real codex-cli context-envelope response as candidate_invalid instead of an interruption', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-candidate-replay-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const captured = await readFile(
      new URL('./fixtures/codex-cli-context-envelope-as-outline.md', import.meta.url),
      'utf8',
    );
    const authoring = createInMemoryCourseAuthoringRepositories();
    const runtime = createGenerationRuntime({
      repository: createInMemoryRepositories().generationTasks,
      unitOfWork,
      providers: [
        createMockProvider({ id: 'codex-cli-replay', script: [{ type: 'text', text: captured }] }),
      ],
      nextId: () => 'task_replayed_invalid',
      now: () => new Date('2026-07-14T06:42:28.447Z'),
    });
    const module = createCourseAuthoringModule({
      repositories: authoring,
      unitOfWork,
      generationRuntime: runtime,
      providerId: 'codex-cli-replay',
      draftStore: { saveDraft: async () => undefined },
    });
    await module.createOutlineSession({
      outlineSessionId: 'session_replay',
      courseMode: 'argument_clash',
      topic: '自我与外界的冲突',
      assessmentArtifactId: 'assessment_replay',
    });
    const frameLog = createGenerationFrameLog(dataRoot);
    const background: Array<() => Promise<void>> = [];
    const coordinator = createCandidateGenerationCoordinator({
      module,
      repositories: authoring,
      runtime,
      execution: createGenerationExecution({ runtime, frameLog }),
      frameLog,
      nextCandidateId: () => 'candidate_must_not_exist',
      dispatchBackground: (work) => background.push(work),
    });

    const result = await coordinator.generate({
      commandId: 'command_replay',
      outlineSessionId: 'session_replay',
    });

    expect(result).toMatchObject({
      taskId: 'task_replayed_invalid',
      state: 'running',
    });
    expect(background).toHaveLength(1);

    await background[0]!();

    await expect(
      authoring.candidateVersions.get('candidate_must_not_exist'),
    ).resolves.toBeUndefined();
    const replay = await frameLog.readAfter('task_replayed_invalid', 0);
    expect(replay.frames.at(-1)).toMatchObject({
      type: 'task.failed',
      data: { problem: { code: 'candidate_invalid' } },
    });
  });

  it('replaces an expired active candidate task on retry and completes the streamed outline', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'learning-more-candidate-retry-'));
    roots.push(directory);
    const dataRoot = DataRoot.create(directory);
    await initializeStoreLayout(createStorePaths(dataRoot));
    const authoring = createInMemoryCourseAuthoringRepositories();
    const generationRepositories = createInMemoryRepositories();
    const provider = () =>
      createApiProvider({
        id: 'replay-api',
        transport: async function* () {
          yield { type: 'text' as const, text: markdown };
        },
      });
    const beforeRestart = createGenerationRuntime({
      repository: generationRepositories.generationTasks,
      unitOfWork,
      providers: [provider()],
      nextId: () => 'task_interrupted',
      now: () => new Date('2026-07-14T00:00:00.000Z'),
    });
    const moduleBeforeRestart = createCourseAuthoringModule({
      repositories: authoring,
      unitOfWork,
      generationRuntime: beforeRestart,
      providerId: 'replay-api',
      draftStore: { saveDraft: async () => undefined },
    });
    await moduleBeforeRestart.createOutlineSession({
      outlineSessionId: 'session_retry',
      courseMode: 'standard',
      topic: 'probability',
      assessmentArtifactId: 'assessment_retry',
    });
    await moduleBeforeRestart.requestCandidate({
      commandId: 'command_interrupted',
      outlineSessionId: 'session_retry',
      inputSnapshotHash: 'interrupted-hash',
    });
    const interrupted = await beforeRestart.get('task_interrupted');
    await generationRepositories.generationTasks.save(
      tx,
      {
        ...interrupted,
        status: 'running',
        leaseExpiresAt: '2026-07-14T00:00:30.000Z',
        attempts: [
          {
            providerId: 'replay-api',
            startedAt: '2026-07-14T00:00:00.000Z',
            status: 'running',
            emittedDelta: false,
          },
        ],
      },
      interrupted.resourceVersion,
    );

    const afterRestart = createGenerationRuntime({
      repository: generationRepositories.generationTasks,
      unitOfWork,
      providers: [provider()],
      nextId: () => 'task_retried',
      now: () => new Date('2026-07-14T00:01:00.000Z'),
    });
    const moduleAfterRestart = createCourseAuthoringModule({
      repositories: authoring,
      unitOfWork,
      generationRuntime: afterRestart,
      providerId: 'replay-api',
      draftStore: { saveDraft: async () => undefined },
    });
    const frameLog = createGenerationFrameLog(dataRoot);
    const background: Array<() => Promise<void>> = [];
    const coordinator = createCandidateGenerationCoordinator({
      module: moduleAfterRestart,
      repositories: authoring,
      runtime: afterRestart,
      execution: createGenerationExecution({
        runtime: afterRestart,
        frameLog,
      }),
      frameLog,
      nextCandidateId: () => 'candidate_retried',
      dispatchBackground: (work) => background.push(work),
    });

    await expect(
      coordinator.generate({ commandId: 'command_retry', outlineSessionId: 'session_retry' }),
    ).resolves.toMatchObject({ taskId: 'task_retried', state: 'running' });
    await expect(afterRestart.get('task_interrupted')).resolves.toMatchObject({
      status: 'cancelled',
      errorCode: 'generation_cancelled',
    });
    expect(background).toHaveLength(1);

    await background[0]!();

    await expect(afterRestart.get('task_retried')).resolves.toMatchObject({
      status: 'completed',
      draftMarkdown: markdown,
    });
    await expect(authoring.candidateVersions.get('candidate_retried')).resolves.toBeDefined();
  });
});
