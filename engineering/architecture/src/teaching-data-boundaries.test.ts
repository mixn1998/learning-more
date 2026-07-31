import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('interactive teaching and reasoning-data architecture boundaries', () => {
  const learningRuntime = source('apps/server/src/bootstrap/local-application/learning-runtime.ts');
  const profileRuntime = source('apps/server/src/bootstrap/local-application/profile-runtime.ts');
  const teachingModule = source(
    'apps/server/src/modules/interactive-teaching/implementation/interactive-teaching.ts',
  );
  const observer = source(
    'apps/server/src/modules/interactive-teaching/implementation/generation-teaching-observer.ts',
  );
  const reviewWriter = source(
    'apps/server/src/modules/review-closure/implementation/generation-review-writer.ts',
  );
  const courseReviewWorkflow = source(
    'apps/server/src/modules/review-closure/implementation/course-review.ts',
  );
  const reasoningContracts = source('packages/contracts/src/global-user-profile.ts');
  const archiveStore = source('apps/server/src/persistence/course-archive-store.ts');
  const profileRoutes = source('apps/server/src/http/routes/profile.ts');

  it('wires the deep teaching module at the HTTP composition root instead of the legacy scene coordinator', () => {
    expect(learningRuntime).toContain('createInteractiveTeaching');
    expect(learningRuntime).toContain('teaching: interactiveTeachingRuntime.module');
    expect(learningRuntime).not.toContain('createSessionGenerationCoordinator');
    expect(learningRuntime).not.toContain('lesson-response@v1');
  });

  it('keeps raw observation mode-neutral and connects it through a narrow reasoning sink port', () => {
    expect(observer).not.toMatch(/courseMode|playIntent/u);
    expect(teachingModule).toContain('../ports/reasoning-behavior-sink.js');
    expect(teachingModule).not.toMatch(/modules\/global-user-profile/u);
    expect(learningRuntime).toContain('reasoningBehaviorSink: input.profile.reasoningBehaviorSink');
  });

  it('uses open semantic dimensions rather than fixed thought-type columns', () => {
    expect(reasoningContracts).toContain('behaviorSummary');
    expect(reasoningContracts).toContain('ReasoningDimensionDefinitionSchema');
    expect(reasoningContracts).not.toMatch(/logicScore|divergentScore|metaphorScore|behaviorType/u);
  });

  it('generates Review from a complete checkpoint without scene templates or mode-specific schemas', () => {
    expect(reviewWriter).toContain("observationCompleteness !== 'complete'");
    expect(reviewWriter).toContain('reviewLens');
    expect(reviewWriter).not.toMatch(/stage-review@v1|final-review@v1|templateRef/u);
    expect(courseReviewWorkflow).toContain('reviewTask.submit');
    expect(courseReviewWorkflow).not.toMatch(/course-review@v1|templateRef/u);
  });

  it('keeps authoritative user-profile persistence without exposing a retired projection', () => {
    expect(learningRuntime).toContain('createLocalFileTeachingLedgerRepository');
    expect(profileRuntime).toContain('createLocalFileReasoningBehaviorRepository');
    expect(profileRuntime).toContain('filter.courseIds.length > 0');
    expect(learningRuntime).toMatch(/interactiveTeachingRuntime\s*\.recoverSession/u);
    expect(learningRuntime).toContain("projectionStatus = 'degraded'");
    expect(profileRoutes).not.toContain("app.get('/api/v1/profile-facts'");
    expect(profileRoutes).not.toContain('portrait-evidence');
  });

  it('cascades the new ledger and reasoning data on permanent course deletion', () => {
    expect(archiveStore).toContain("'teaching-ledgers'");
    expect(archiveStore).toContain("'reasoning-behavior-episodes'");
    expect(archiveStore).toContain("'reasoning-behavior-analyses'");
    expect(archiveStore).toContain('const reasoningAnalyses = byType.get');
  });
});
