import type { ReviewDocument, ReviewTextBlock } from '@learning-more/contracts';

import type { ReviewEvidencePack } from '../../modules/review-closure/implementation/generation-review-writer.js';
import type { LocalLearningRuntime } from './learning-runtime.js';

export function createReviewEvidence(learning: Pick<LocalLearningRuntime, 'access'>): Readonly<{
  build(
    kind: 'stage' | 'final',
    sessionId: string,
    sourceSnapshotHash: string,
  ): Promise<ReviewEvidencePack>;
  assertRefs(
    document: ReviewDocument | undefined,
    expectedKind: ReviewDocument['kind'],
    allowedRefs: ReadonlySet<string>,
  ): void;
}> {
  const teachingContextSources = learning.access.teachingContextSources;

  function documentBlocks(document: ReviewDocument): readonly ReviewTextBlock[] {
    if (document.kind === 'lesson-final') {
      return [
        document.knowledgeMap,
        ...document.performance,
        ...(document.additionalSections ?? []),
      ];
    }
    if (document.kind === 'lesson-stage') {
      return [
        ...document.establishedUnderstanding,
        ...document.pendingValidation,
        document.knowledgeMap,
        ...document.performance,
        ...(document.additionalSections ?? []),
      ];
    }
    return [
      ...document.knowledgeThreads,
      ...document.strengths,
      ...document.development,
      ...document.boundaries,
      ...document.extensions,
      ...(document.additionalSections ?? []),
    ];
  }

  return {
    assertRefs(document, expectedKind, allowedRefs): void {
      if (document === undefined) return;
      if (document.kind !== expectedKind) throw new Error('review_document_kind_mismatch');
      const refs = documentBlocks(document).flatMap((block) => block.evidenceRefs ?? []);
      if (refs.some((ref) => !allowedRefs.has(ref))) {
        throw new Error('review_document_evidence_ref_invalid');
      }
    },
    async build(kind, sessionId, sourceSnapshotHash) {
      const ledger = await learning.access.getTeachingLedger(sessionId);
      if (ledger === undefined) throw new Error('review_teaching_ledger_not_found');
      const checkpoint = [...ledger.checkpoints]
        .reverse()
        .find((candidate) => candidate.sourceSnapshotHash === sourceSnapshotHash);
      if (checkpoint === undefined) throw new Error('review_checkpoint_not_found');
      const facts = await teachingContextSources.getCourseAndLesson({
        courseId: ledger.courseId,
        lessonId: ledger.lessonId,
      });
      const messages = await teachingContextSources.listMessages(sessionId);
      const observationIds = new Set(
        checkpoint.observationRefs.map((ref) => ref.replace(/^observation:/u, '')),
      );
      return {
        kind,
        checkpoint,
        course: { courseId: facts.course.courseId, title: facts.course.title },
        lesson: {
          lessonId: facts.lesson.lessonId,
          title: facts.lesson.title,
          objective: facts.lesson.objective,
          coreKnowledgePoints: facts.lesson.coreKnowledgePoints.map((point) => point.text),
        },
        observations: ledger.observations.filter((observation) =>
          observationIds.has(observation.observationId),
        ),
        messages: messages.filter((message) =>
          checkpoint.sourceMessageIds.includes(message.messageId),
        ),
        ...(facts.course.playIntent === undefined ? {} : { reviewLens: facts.course.playIntent }),
      } as const;
    },
  };
}
