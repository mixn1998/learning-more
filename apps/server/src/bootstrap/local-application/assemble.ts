import type { ServerDependencies } from '../app.js';
import type { LocalApplication, LocalApplicationOptions } from './contracts.js';
import { createLocalCourseRuntime } from './course-runtime.js';
import { createLocalEventFactsRuntime } from './event-facts-runtime.js';
import { createLocalFoundation } from './foundation.js';
import { createLocalGenerationRuntime } from './generation-runtime.js';
import { createHomeRouteOptions } from './home-runtime.js';
import { createLocalInsightsRuntime } from './insights-runtime.js';
import { createLocalLearningRuntime } from './learning-runtime.js';
import { createLocalPlanningRuntime } from './planning-runtime.js';
import { createLocalProfileRuntime } from './profile-runtime.js';
import { createRuntimeReadiness } from './readiness.js';
import { createLocalReviewRuntime } from './review-runtime.js';

export async function assembleLocalApplication(
  options: LocalApplicationOptions,
): Promise<LocalApplication> {
  const foundation = await createLocalFoundation(options);
  const {
    dataRoot,
    unitOfWork,
    artifactStore,
    now: runtimeNow,
    instanceId: runtimeInstanceId,
  } = foundation;
  const generation = await createLocalGenerationRuntime({
    dataRoot,
    unitOfWork,
    now: runtimeNow,
    applicationOptions: options,
  });
  const { runtime: generationRuntime, frameLog, providerConfigService } = generation;
  const events = await createLocalEventFactsRuntime({ dataRoot, unitOfWork });
  const profile = createLocalProfileRuntime({
    dataRoot,
    unitOfWork,
    now: runtimeNow,
    generation,
    events,
  });
  const course = createLocalCourseRuntime({
    dataRoot,
    unitOfWork,
    artifactStore,
    now: runtimeNow,
    generation,
    events,
    profile,
  });
  await course.reconcileOutlineLiveReferences();
  const { courseRepositories } = course;
  const learning = createLocalLearningRuntime({
    dataRoot,
    unitOfWork,
    artifactStore,
    instanceId: runtimeInstanceId,
    now: runtimeNow,
    course,
    generation,
    events,
    profile,
  });
  const planningRuntime = createLocalPlanningRuntime({
    dataRoot,
    unitOfWork,
    artifactStore,
    course,
    learning,
    events,
    readRevision: foundation.readRevision,
  });
  const review = createLocalReviewRuntime({
    dataRoot,
    unitOfWork,
    artifactStore,
    now: runtimeNow,
    course,
    learning,
    planning: planningRuntime,
    generation,
    events,
    profile,
  });
  await review.recoverCommittingClosures();
  const insights = createLocalInsightsRuntime({
    dataRoot,
    unitOfWork,
    artifactStore,
    now: runtimeNow,
    generation,
    events,
    course,
    learning,
  });
  await insights.start();
  await generationRuntime.recoverExpiredLeases();
  // Candidate tasks need the authoring coordinator after execution so their
  // Markdown is compiled and the outline session is advanced. Resume both
  // pending work and terminal tasks whose authoring projection was not saved.
  void course.recoverGenerationTasks().catch(() => undefined);
  // Teaching observations are derived from durable session history. Rebuild them in the
  // background so an unrelated historical session cannot delay course authoring or startup.
  void learning.recoverTeachingSessions().catch(() => undefined);
  profile.start();
  let backgroundRecovery: Promise<void> | undefined;
  const startBackgroundRecovery = () => {
    backgroundRecovery ??= (async () => {
      await review.recoverProfileCheckpoints();
      await profile.recoverReasoningAnalysis();
    })().catch(() => undefined);
  };
  const getProjectionStatus = () =>
    learning.getProjectionStatus() === 'ready' && profile.getProjectionStatus() === 'ready'
      ? ('ready' as const)
      : ('degraded' as const);
  const readiness = createRuntimeReadiness({
    runtimeIdentity: options.runtimeIdentity,
    instanceId: runtimeInstanceId,
    getProviderStatus: generation.getReadiness,
    getProjectionStatus,
  });
  const home = createHomeRouteOptions({
    now: runtimeNow,
    course,
    learning,
    planning: planningRuntime,
    dataRoot,
    readRevision: foundation.readRevision,
  });
  const serverDependencies: ServerDependencies = {
    getRuntimeReadiness: async () => {
      const status = await readiness();
      startBackgroundRecovery();
      return status;
    },
    home,
    courseAuthoring: course.routes,
    learningSession: learning.routes,
    reviewClosure: review.routes,
    planning: planningRuntime.routes,
    learningFacts: insights.routes,
    profile: profile.profileRoutes,
    portraits: profile.portraitRoutes,
    generationFrameLog: frameLog,
    runtimeControl: generation.runtimeControl,
    localSecurity: {
      allowedOrigin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
      csrfToken: options.csrfToken,
    },
  };
  return {
    close: async () => {
      profile.close();
      await insights.close();
    },
    serverDependencies,
    courseRepositories,
    frameLog,
    dataRoot,
    generationRuntime,
    providerConfigService,
  };
}
