import type { ReviewDocument, ReviewTextBlock } from '@learning-more/contracts';

import type { ReviewEvidencePack } from '../../modules/review-closure/implementation/generation-review-writer.js';
import { createMarkdownArtifactStore } from '../../persistence/markdown-artifact-store.js';
import type { LocalLearningRuntime } from './learning-runtime.js';

export function createReviewEvidence(
  learning: Pick<LocalLearningRuntime, 'access'>,
  artifactStore: Pick<ReturnType<typeof createMarkdownArtifactStore>, 'read' | 'readDraft'>,
): Readonly<{
  build(
    kind: 'stage' | 'final',
    sessionId: string,
    sourceSnapshotHash: string,
  ): Promise<ReviewEvidencePack>;
  normalizeRefs(
    document: ReviewDocument | undefined,
    expectedKind: ReviewDocument['kind'],
    sourceMessageIds: readonly string[],
  ): ReviewDocument | undefined;
  normalizeAllowedRefs(
    document: ReviewDocument | undefined,
    expectedKind: ReviewDocument['kind'],
    allowedRefs: ReadonlySet<string>,
  ): ReviewDocument | undefined;
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

  function normalizeDocumentRefs(
    document: ReviewDocument | undefined,
    expectedKind: ReviewDocument['kind'],
    allowedRefs: ReadonlySet<string>,
    resolveRef: (ref: string) => string,
  ): ReviewDocument | undefined {
    if (document === undefined) return undefined;
    if (document.kind !== expectedKind) throw new Error('review_document_kind_mismatch');
    let suppliedRefCount = 0;
    let acceptedRefCount = 0;
    const normalizeValue = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalizeValue);
      if (value === null || typeof value !== 'object') return value;
      const source = value as Readonly<Record<string, unknown>>;
      const normalized = Object.fromEntries(
        Object.entries(source)
          .filter(([key]) => key !== 'evidenceRefs')
          .map(([key, item]) => [key, normalizeValue(item)]),
      );
      if (Array.isArray(source.evidenceRefs)) {
        suppliedRefCount += source.evidenceRefs.filter((ref) => typeof ref === 'string').length;
        const refs = [
          ...new Set(
            source.evidenceRefs
              .filter((ref): ref is string => typeof ref === 'string')
              .map(resolveRef)
              .filter((ref) => allowedRefs.has(ref)),
          ),
        ];
        acceptedRefCount += refs.length;
        if (refs.length > 0) normalized.evidenceRefs = refs;
      }
      return normalized;
    };
    const normalized = normalizeValue(document) as ReviewDocument;
    const refs = documentBlocks(normalized).flatMap((block) => block.evidenceRefs ?? []);
    if (refs.some((ref) => !allowedRefs.has(ref))) {
      throw new Error('review_document_evidence_ref_invalid');
    }
    if (suppliedRefCount > 0 && acceptedRefCount === 0) {
      throw new Error('review_document_evidence_refs_unusable');
    }
    return normalized;
  }

  return {
    normalizeRefs(document, expectedKind, sourceMessageIds) {
      const allowedRefs = new Set(sourceMessageIds.map((id) => `message:${id}`));
      const aliases = new Map<string, string>(
        sourceMessageIds.map((id, index) => [`E${index + 1}`, `message:${id}`] as const),
      );
      return normalizeDocumentRefs(
        document,
        expectedKind,
        allowedRefs,
        (ref) => aliases.get(ref.toUpperCase()) ?? ref,
      );
    },
    normalizeAllowedRefs(document, expectedKind, allowedRefs) {
      return normalizeDocumentRefs(document, expectedKind, allowedRefs, (ref) => ref);
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
      const messages = await Promise.all(
        (await learning.access.listMessages(sessionId)).map(async (message) => ({
          messageId: message.id,
          role: message.role,
          completionStatus: message.completionStatus,
          markdown:
            (await artifactStore.read(message.contentArtifactRef))?.content ??
            (await artifactStore.readDraft(message.contentArtifactRef)) ??
            '',
          sourceRef: `message:${message.id}`,
          ...(message.generationTaskId === undefined
            ? {}
            : { generationTaskId: message.generationTaskId }),
        })),
      );
      const observationIds = new Set(
        checkpoint.observationRefs.map((ref) => ref.replace(/^observation:/u, '')),
      );
      const checkpointMessages = messages.filter((message) =>
        checkpoint.sourceMessageIds.includes(message.messageId),
      );
      const classroomSummarySourceMessageId =
        checkpoint.teachingState.reviewProjection?.classroomSummarySourceMessageId ??
        (checkpoint.teachingState.summaryStatus === 'delivered'
          ? checkpointMessages.findLast(
              (message) => message.role === 'assistant' && message.completionStatus === 'complete',
            )?.messageId
          : undefined);
      const classroomSummary =
        classroomSummarySourceMessageId === undefined
          ? undefined
          : checkpointMessages.find(
              (message) => message.messageId === classroomSummarySourceMessageId,
            );
      const completedAssistantMessages = checkpointMessages.filter(
        (message) => message.role === 'assistant' && message.completionStatus === 'complete',
      );
      const storedProjection = checkpoint.teachingState.reviewProjection;
      const comprehensiveApplicationStartSourceMessageId =
        storedProjection?.comprehensiveApplicationStartSourceMessageId;
      const comprehensiveSynthesisSourceMessageId =
        storedProjection?.comprehensiveSynthesisSourceMessageId ??
        storedProjection?.methodologyInsight?.sourceMessageId;
      const comprehensiveStartIndex =
        comprehensiveApplicationStartSourceMessageId === undefined
          ? -1
          : checkpointMessages.findIndex(
              (message) => message.messageId === comprehensiveApplicationStartSourceMessageId,
            );
      const comprehensiveEndIndex =
        comprehensiveSynthesisSourceMessageId === undefined
          ? -1
          : checkpointMessages.findIndex(
              (message) => message.messageId === comprehensiveSynthesisSourceMessageId,
            );
      const comprehensiveSegment =
        comprehensiveStartIndex >= 0 && comprehensiveEndIndex >= comprehensiveStartIndex
          ? checkpointMessages
              .slice(comprehensiveStartIndex, comprehensiveEndIndex + 1)
              .filter(
                (message) =>
                  message.role === 'assistant' &&
                  message.completionStatus === 'complete' &&
                  message.messageId !== classroomSummarySourceMessageId &&
                  message.markdown.trim() !== '',
              )
          : [];
      const comprehensiveSynthesis =
        comprehensiveSegment.length > 0
          ? {
              messageId:
                comprehensiveSynthesisSourceMessageId ??
                comprehensiveSegment.at(-1)?.messageId ??
                comprehensiveSegment[0]!.messageId,
              markdown: comprehensiveSegment
                .map(
                  (message, index) => `【综合应用片段 ${index + 1}】\n${message.markdown.trim()}`,
                )
                .join('\n\n'),
            }
          : comprehensiveSynthesisSourceMessageId === undefined
            ? completedAssistantMessages
                .filter((message) => message.messageId !== classroomSummarySourceMessageId)
                .findLast((message) =>
                  /(?:综合应用|可以带走的一句话|方法论启示|迁移方法)/u.test(message.markdown),
                )
            : checkpointMessages.find(
                (message) => message.messageId === comprehensiveSynthesisSourceMessageId,
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
        messages: checkpointMessages,
        ...(classroomSummary === undefined || classroomSummary.markdown.trim() === ''
          ? {}
          : {
              classroomSummary: {
                sourceMessageId: classroomSummary.messageId,
                markdown: classroomSummary.markdown,
              },
            }),
        ...(comprehensiveSynthesis === undefined || comprehensiveSynthesis.markdown.trim() === ''
          ? {}
          : {
              comprehensiveSynthesis: {
                sourceMessageId: comprehensiveSynthesis.messageId,
                markdown: comprehensiveSynthesis.markdown,
              },
            }),
        ...(facts.course.playIntent === undefined ? {} : { reviewLens: facts.course.playIntent }),
      } as const;
    },
  };
}
