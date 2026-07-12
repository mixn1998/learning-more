import { randomUUID } from 'node:crypto';

import { createMockProvider, type MockProviderStep } from '../ai-providers/mock-provider.js';
import { createCandidateGenerationCoordinator } from '../modules/course-authoring/implementation/candidate-generation-coordinator.js';
import { createCourseAuthoringFacade } from '../modules/course-authoring/implementation/course-authoring-facade.js';
import { createCourseAuthoringModule } from '../modules/course-authoring/implementation/course-authoring-module.js';
import { createGenerationFrameLog } from '../modules/generation-runtime/implementation/frame-log.js';
import { createGenerationRuntime } from '../modules/generation-runtime/implementation/generation-runtime.js';
import { createLocalFileCourseAuthoringRepositories } from '../persistence/course-authoring-repositories.js';
import { createLocalFileCourseCreationRepositories } from '../persistence/course-creation-repositories.js';
import { DataRoot } from '../persistence/data-root.js';
import { createEventDispatcher } from '../persistence/event-dispatcher.js';
import { createEventLog } from '../persistence/event-log.js';
import { createLocalFileRepositories } from '../persistence/local-file-repositories.js';
import { createMarkdownArtifactStore } from '../persistence/markdown-artifact-store.js';
import { createOutbox } from '../persistence/outbox.js';
import { createStorePaths, initializeStoreLayout } from '../persistence/paths.js';
import { createUnitOfWork } from '../persistence/unit-of-work.js';
import type { ServerDependencies } from './app.js';

function candidateMarkdown(version: number): string {
  return `\`\`\`learning-more-outline
{"courseGoals":["Understand probability"],"disciplineTag":"mathematics","topicTags":["probability"],"lessons":[{"id":"probability-space","title":"Probability spaces","objective":"Understand sample spaces","coreKnowledgePoints":["sample space"],"prerequisiteLessonIds":[],"estimatedMinutes":30,"sourceRefs":["source_topic"]},{"id":"random-variable","title":"Random variables","objective":"Model outcomes","coreKnowledgePoints":["random variable"],"prerequisiteLessonIds":["probability-space"],"estimatedMinutes":45,"sourceRefs":["source_topic"]}]}
\`\`\`
# Candidate outline ${version}

1. Probability spaces
2. Random variables`;
}

function mockScript(attempt: number, failOnce: boolean): readonly MockProviderStep[] {
  if (failOnce && attempt === 1) {
    return [
      { type: 'text', text: '# Partial candidate' },
      { type: 'fail', error: new Error('mock_provider_interrupted') },
    ];
  }
  return [{ type: 'text', text: candidateMarkdown(attempt) }];
}

export async function createLocalApplication(options: {
  readonly dataRoot: string;
  readonly csrfToken: string;
  readonly allowedOrigin?: string;
  readonly mockFailOnce?: boolean;
}) {
  const dataRoot = DataRoot.create(options.dataRoot);
  await initializeStoreLayout(createStorePaths(dataRoot));
  const unitOfWork = createUnitOfWork({ dataRoot });
  const authoringRepositories = createLocalFileCourseAuthoringRepositories(dataRoot);
  const courseRepositories = createLocalFileCourseCreationRepositories(dataRoot);
  const localRepositories = createLocalFileRepositories(dataRoot);
  const frameLog = createGenerationFrameLog(dataRoot);
  const provider = createMockProvider({
    id: 'mock',
    scriptFactory: (attempt) => mockScript(attempt, options.mockFailOnce ?? false),
  });
  const generationRuntime = createGenerationRuntime({
    repository: localRepositories.generationTasks,
    unitOfWork,
    providers: [provider],
    nextId: () => `task_${randomUUID()}`,
  });
  const artifactStore = createMarkdownArtifactStore(dataRoot, unitOfWork);
  const authoringModule = createCourseAuthoringModule({
    repositories: authoringRepositories,
    unitOfWork,
    generationRuntime,
    providerId: 'mock',
    draftStore: artifactStore,
  });
  const candidateGeneration = createCandidateGenerationCoordinator({
    module: authoringModule,
    repositories: authoringRepositories,
    runtime: generationRuntime,
    frameLog,
    nextCandidateId: () => `candidate_${randomUUID()}`,
  });
  const outbox = createOutbox({
    dataRoot,
    unitOfWork,
    eventLog: createEventLog(dataRoot),
    dispatcher: createEventDispatcher(),
  });
  const nextId = (kind: 'session' | 'course' | 'event' | 'outline' | 'adjustment') =>
    `${kind}_${randomUUID()}`;
  const courseAuthoring = createCourseAuthoringFacade({
    authoring: authoringRepositories,
    courses: courseRepositories,
    unitOfWork,
    candidateGeneration,
    outbox,
    assessmentStore: artifactStore,
    nextId,
    now: () => new Date(),
  });
  const serverDependencies: ServerDependencies = {
    getRuntimeReadiness: async () => ({
      status: 'ready',
      instanceId: `instance_${randomUUID()}`,
      buildId: 'development',
      protocolVersion: '1',
      storeStatus: 'ready',
      projectionStatus: 'ready',
      providerStatus: 'ready',
    }),
    courseAuthoring: {
      module: courseAuthoring,
      nextCommandId: () => `command_${randomUUID()}`,
      nextCorrelationId: () => `correlation_${randomUUID()}`,
      now: () => new Date(),
    },
    generationFrameLog: frameLog,
    localSecurity: {
      allowedOrigin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
      csrfToken: options.csrfToken,
    },
  };
  return { serverDependencies, courseRepositories, frameLog, dataRoot };
}
