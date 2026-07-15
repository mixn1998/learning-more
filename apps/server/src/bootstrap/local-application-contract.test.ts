import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalApplication } from './local-application.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('local application public interface', () => {
  it('keeps the application and route dependency surfaces stable', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'learning-more-local-contract-'));
    roots.push(dataRoot);
    const local = await createLocalApplication({ dataRoot, csrfToken: 'test-csrf' });

    try {
      expect(Object.keys(local).sort()).toEqual([
        'close',
        'courseRepositories',
        'dataRoot',
        'frameLog',
        'generationRuntime',
        'providerConfigService',
        'serverDependencies',
      ]);
      expect(Object.keys(local.serverDependencies).sort()).toEqual([
        'courseAuthoring',
        'generationFrameLog',
        'getRuntimeReadiness',
        'home',
        'learningFacts',
        'learningSession',
        'localSecurity',
        'planning',
        'portraits',
        'profile',
        'reviewClosure',
        'runtimeControl',
      ]);
      expect(Object.keys(local.serverDependencies.home!).sort()).toEqual(['getHome']);
      expect(Object.keys(local.serverDependencies.courseAuthoring!).sort()).toEqual([
        'ingestMaterial',
        'module',
        'nextCommandId',
        'nextCorrelationId',
        'now',
      ]);
      expect(Object.keys(local.serverDependencies.learningSession!).sort()).toEqual([
        'getLessonEntryState',
        'getLessonRecord',
        'getTeachingProgress',
        'listSessionMessages',
        'loadArtifactMarkdown',
        'module',
        'nextCommandId',
        'nextCorrelationId',
        'nextMessageId',
        'now',
        'resolveSession',
        'saveUserMessage',
        'supplementary',
        'teaching',
      ]);
      expect(Object.keys(local.serverDependencies.reviewClosure!).sort()).toEqual([
        'nextCommandId',
        'nextCorrelationId',
        'now',
        'services',
      ]);
      expect(Object.keys(local.serverDependencies.planning!).sort()).toEqual([
        'nextCommandId',
        'nextCorrelationId',
        'now',
        'planFlows',
        'planning',
      ]);
      expect(Object.keys(local.serverDependencies.learningFacts!).sort()).toEqual(['queries']);
      expect(Object.keys(local.serverDependencies.profile!).sort()).toEqual([
        'getGlobalProfile',
        'getReasoningAnalysis',
        'listEvidence',
        'listReasoningEpisodes',
        'refreshReasoningAnalysis',
      ]);
      expect(Object.keys(local.serverDependencies.portraits!).sort()).toEqual([
        'getCurrent',
        'getVersion',
        'nextCorrelationId',
        'requestRefresh',
      ]);
      expect(Object.keys(local.serverDependencies.runtimeControl!).sort()).toEqual([
        'getProviderCatalog',
        'getProviderStatus',
        'nextCorrelationId',
        'reconnectProvider',
        'startProviderAuthentication',
        'switchProvider',
      ]);
      expect(Object.keys(local.serverDependencies.localSecurity!).sort()).toEqual([
        'allowedOrigin',
        'csrfToken',
      ]);
    } finally {
      await expect(local.close()).resolves.toBeUndefined();
      await expect(local.close()).resolves.toBeUndefined();
    }
  });
});
