import type { ServerDependencies } from '../app.js';
import {
  createLocalRequestAccessAdapter,
  LOCAL_APPLICATION_PRINCIPAL,
} from '../../environment/request-access.js';
import type { LocalApplication, LocalApplicationOptions } from './contracts.js';
import { createLocalCourseRuntime } from './course-runtime.js';
import { createLocalEventFactsRuntime } from './event-facts-runtime.js';
import { createLocalFoundation } from './foundation.js';
import { createLocalGenerationRuntime } from './generation-runtime.js';
import { createHomeRouteOptions } from './home-runtime.js';
import { createLocalInsightsRuntime } from './insights-runtime.js';
import { createLocalLearningRuntime } from './learning-runtime.js';
import { createLocalLearningNotesRuntime } from './learning-notes-runtime.js';
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
    ...(options.logProjectionEvent === undefined
      ? {}
      : { logProjectionEvent: options.logProjectionEvent }),
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
    ...(options.logProjectionEvent === undefined
      ? {}
      : { logProjectionEvent: options.logProjectionEvent }),
  });
  const learningNotes = createLocalLearningNotesRuntime({
    dataRoot,
    unitOfWork,
    course,
    now: runtimeNow,
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
    ...(options.lessonClosureReconcileIntervalMs === undefined
      ? {}
      : { reconcileIntervalMs: options.lessonClosureReconcileIntervalMs }),
  });
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
  const startupRecovery = (async () => {
    const recover = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch {
        // Durable state remains available and the next startup/reconciler can retry.
      }
    };
    // Only the transaction journal is recovered before HTTP starts. Historical cleanup,
    // schedulers and resumable tasks are durable and can recover without blocking reads.
    await recover(() => course.reconcileOutlineLiveReferences());
    await recover(() => review.recoverCommittingClosures());
    await recover(() => insights.start());
    await recover(() => generationRuntime.recoverExpiredLeases());
    await recover(() => generation.runLifecycleMaintenance());
    await Promise.all([
      recover(() => course.recoverInterruptedAuthoringTurns()),
      recover(() => course.recoverGenerationTasks()),
      recover(() => course.recoverTeachingWeightMetadata()),
      recover(() => learning.recoverTeachingSessions()),
    ]);
  })();
  profile.start();
  let backgroundRecovery: Promise<void> | undefined;
  const startBackgroundRecovery = () => {
    backgroundRecovery ??= (async () => {
      await review.recoverProfileCheckpoints();
      await profile.recoverReasoningAnalysis();
    })().catch(() => undefined);
  };
  const getProjectionStatus = () => learning.getProjectionStatus();
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
    learningNotes,
    reviewClosure: review.routes,
    planning: planningRuntime.routes,
    learningFacts: {
      ...insights.routes,
      async getLessonActualInterval(lessonId) {
        const record = await learning.access.getRecord(lessonId);
        const closedIntervals = (record?.intervals ?? []).filter(
          (interval): interval is typeof interval & { endedAt: string } =>
            interval.endedAt !== undefined &&
            Number.isFinite(Date.parse(interval.startedAt)) &&
            Number.isFinite(Date.parse(interval.endedAt)) &&
            Date.parse(interval.endedAt) > Date.parse(interval.startedAt),
        );
        if (closedIntervals.length === 0) return undefined;
        return {
          actualStartedAt: closedIntervals.reduce(
            (earliest, interval) =>
              Date.parse(interval.startedAt) < Date.parse(earliest) ? interval.startedAt : earliest,
            closedIntervals[0]!.startedAt,
          ),
          actualEndedAt: closedIntervals.reduce(
            (latest, interval) =>
              Date.parse(interval.endedAt) > Date.parse(latest) ? interval.endedAt : latest,
            closedIntervals[0]!.endedAt,
          ),
        };
      },
    },
    profile: profile.profileRoutes,
    generationFrameLog: frameLog,
    runtimeControl: generation.runtimeControl,
    requestAccess:
      options.requestAccess ??
      createLocalRequestAccessAdapter({
        allowedOrigin: options.allowedOrigin ?? 'http://127.0.0.1:5173',
        csrfToken: options.csrfToken,
        principal: LOCAL_APPLICATION_PRINCIPAL,
      }),
  };
  return {
    close: async () => {
      await Promise.allSettled([
        startupRecovery,
        ...(backgroundRecovery === undefined ? [] : [backgroundRecovery]),
      ]);
      await profile.close();
      await review.close();
      await insights.close();
      await generation.close();
    },
    serverDependencies,
    courseRepositories,
    frameLog,
    dataRoot,
    generationRuntime,
    providerConfigService,
  };
}
