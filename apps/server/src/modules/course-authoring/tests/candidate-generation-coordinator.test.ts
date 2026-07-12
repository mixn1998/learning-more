import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createMockProvider } from '../../../ai-providers/mock-provider.js';
import { createInMemoryCourseAuthoringRepositories } from '../../../persistence/course-authoring-repositories.js';
import { createInMemoryRepositories } from '../../../persistence/in-memory-repositories.js';
import { DataRoot } from '../../../persistence/data-root.js';
import { createStorePaths, initializeStoreLayout } from '../../../persistence/paths.js';
import { createGenerationFrameLog } from '../../generation-runtime/implementation/frame-log.js';
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
{"courseGoals":["Understand probability"],"disciplineTag":"mathematics","topicTags":["probability"],"lessons":[{"id":"probability-space","title":"Probability spaces","objective":"Understand sample spaces","coreKnowledgePoints":["sample space"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]},{"id":"random-variable","title":"Random variables","objective":"Model outcomes","coreKnowledgePoints":["random variable"],"prerequisiteLessonIds":["probability-space"],"estimatedMinutes":45,"sourceRefs":["source_topic"]}]}
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
    const coordinator = createCandidateGenerationCoordinator({
      module,
      repositories: authoring,
      runtime,
      frameLog,
      nextCandidateId: () => 'candidate_01',
    });

    const result = await coordinator.generate({
      commandId: 'command_01',
      outlineSessionId: 'session_01',
    });

    expect(result).toMatchObject({ taskId: 'task_01', state: 'running', resourceVersion: 3 });
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
});
