import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { GenerationExecution, GenerationRuntime } from '../../generation-runtime/interface.js';
import type { ProfileEvidenceExtractionDraft } from '../model/profile-evidence-candidate.js';
import {
  ProfileEvidenceExtractionDraftSchema,
  type ProfileEvidenceCheckpointInput,
} from '../model/profile-evidence-candidate.js';
import {
  assembleProfileEvidenceContext,
  type AssembledProfileEvidenceContext,
} from './profile-evidence-context-assembler.js';

const PROFILE_EVIDENCE_CAPABILITY = [
  'PROFILE_EVIDENCE_EXTRACTION_V1',
  'OUTPUT_CONTRACT: Return exactly one JSON object with a candidates array and no prose.',
  'candidateKind MUST be one of: durable_preference, durable_fact, learning_behavior, thinking_behavior.',
  'claimDimension MUST be a stable lower-case ASCII dotted identifier matching ^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$, for example thinking_reasoning.dependency_tracing. Put the human-readable Chinese name in label, never in claimDimension.',
  'explicitness MUST be user_declared or ai_observed. qualityFlags MUST be an array containing only direct, complete, ambiguous, or interrupted.',
  'limitations MUST always be a JSON array of strings, including when there is only one limitation.',
  'safetyStatus MUST be usable, sanitized, or blocked. polarity MUST be supporting, limiting, or contradicting. contradictionEvidenceIds MUST be a JSON array.',
  'expiryPolicy MUST be exactly one object: {"kind":"until_corrected"}, {"kind":"window_bound","expiresAt":"ISO-8601"}, or {"kind":"review_after","reviewAt":"ISO-8601"}.',
  '只分析给定受控检查点中的净化片段，提取中性、局部、可撤回的候选证据。',
  'claimDimension 与 label 必须从本次行为证据中开放生成；逻辑、关联、发散、结构、隐喻只是可能示例，不是固定维度表。',
  '当 checkpointKind 为 stage_review_finalized 或 lesson_review_finalized 时，thinking_behavior 必须按该学习会话的抽象维度聚合：合并本质相同的具体表现，label 与 summary 不得携带题目答案、课程专名或单次案例细节。',
  '每项必须引用输入中真实存在的 sourceRefs，并说明限制；证据不足时返回空 candidates。',
  '暂停学习、页面进入后台、计时暂停或会话技术中断只是生命周期事实，任何情况下都不得生成 learning_behavior 或 thinking_behavior 候选。',
  '不得推断人格、智力或能力等级、敏感属性、医学结论、政治宗教倾向，也不得把局部表现写成永久学习风格。',
  '不得确认或改写全局用户档案；只返回 JSON：{candidates:[{candidateKind,claimDimension,label,summary,explicitness,sourceRefs,confidence,qualityFlags,limitations,safetyStatus,blockedReason?,polarity,contradictionEvidenceIds,expiryPolicy}]}。',
].join('\n');

const ExtractionResultSchema = z.strictObject({
  candidates: z.array(ProfileEvidenceExtractionDraftSchema).max(24),
});

const FORBIDDEN_INFERENCE =
  /(?:人格|性格|智商|IQ|永久|天生|固定学习风格|能力等级|政治倾向|宗教|种族|民族|性取向|医学诊断|精神疾病|personality|intelligence|political|religion|ethnicity|sexual orientation|medical diagnosis)/iu;

const PAUSED_LEARNING_BEHAVIOR =
  /(?:暂停学习|学习暂停|页面进入后台|计时暂停|会话技术中断|learning\.session_regulation|session[_ .-]?pause)/iu;

function isPausedLearningBehavior(candidate: ProfileEvidenceExtractionDraft): boolean {
  return (
    (candidate.candidateKind === 'learning_behavior' ||
      candidate.candidateKind === 'thinking_behavior') &&
    PAUSED_LEARNING_BEHAVIOR.test(
      `${candidate.claimDimension}\n${candidate.label}\n${candidate.summary}`,
    )
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseJson(markdown: string): unknown {
  const trimmed = markdown.trim();
  const unwrapped = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
    : trimmed;
  return JSON.parse(unwrapped) as unknown;
}

async function awaitTerminal(
  runtime: GenerationRuntime,
  execution: GenerationExecution | undefined,
  taskId: string,
) {
  if (execution !== undefined) return execution.awaitTerminal(taskId);
  let current = await runtime.get(taskId);
  for (
    let index = 0;
    index < 1_000 && (current.status === 'queued' || current.status === 'running');
    index += 1
  ) {
    const ran = await runtime.runNext();
    current = await runtime.get(taskId);
    if (ran === undefined && (current.status === 'queued' || current.status === 'running')) {
      throw new Error('profile_evidence_scheduler_stalled');
    }
  }
  return current;
}

export type ProfileEvidenceExtractionBatch = Readonly<{
  checkpoint: ProfileEvidenceCheckpointInput;
  sourceSnapshotHash: string;
  analyzerVersion: string;
  extractorVersion: string;
  extractedAt: string;
  candidates: readonly ProfileEvidenceExtractionDraft[];
}>;

function validateDrafts(
  context: AssembledProfileEvidenceContext,
  candidates: readonly ProfileEvidenceExtractionDraft[],
): void {
  const sourceByRef = new Map(
    context.checkpoint.sources.map((source) => [source.sourceRef, source]),
  );
  const existingEvidenceIds = new Set(
    context.checkpoint.existingCandidates.map((candidate) => candidate.evidenceId),
  );
  for (const candidate of candidates) {
    if (new Set(candidate.sourceRefs).size !== candidate.sourceRefs.length) {
      throw new Error('profile_evidence_source_ref_duplicate');
    }
    if (candidate.sourceRefs.some((sourceRef) => !sourceByRef.has(sourceRef))) {
      throw new Error('profile_evidence_source_ref_unsupported');
    }
    if (
      candidate.explicitness === 'user_declared' &&
      !candidate.sourceRefs.some((sourceRef) => sourceByRef.get(sourceRef)?.role === 'user')
    ) {
      throw new Error('profile_evidence_user_declaration_without_user_source');
    }
    if (
      candidate.contradictionEvidenceIds.some((evidenceId) => !existingEvidenceIds.has(evidenceId))
    ) {
      throw new Error('profile_evidence_contradiction_ref_unsupported');
    }
    if (
      FORBIDDEN_INFERENCE.test(
        `${candidate.claimDimension}\n${candidate.label}\n${candidate.summary}`,
      )
    ) {
      throw new Error('profile_evidence_forbidden_inference');
    }
    if (candidate.candidateKind === 'durable_fact' && candidate.explicitness !== 'user_declared') {
      throw new Error('profile_evidence_durable_fact_requires_user_declaration');
    }
  }
}

export function createAiProfileEvidenceExtractor(options: {
  runtime: GenerationRuntime;
  execution?: GenerationExecution;
  providerId: string;
  analyzerVersion: string;
  extractorVersion: string;
  now(): Date;
}) {
  return {
    async extract(input: unknown): Promise<ProfileEvidenceExtractionBatch> {
      const context = assembleProfileEvidenceContext(input);
      const serialized = JSON.stringify({
        checkpoint: context.checkpoint,
        sourceSnapshotHash: context.sourceSnapshotHash,
      });
      const handle = await (options.execution ?? options.runtime).submit({
        taskKey: `profile-evidence:${context.checkpoint.checkpointId}:${context.sourceSnapshotHash}:${options.analyzerVersion}`,
        inputSnapshotHash: context.sourceSnapshotHash,
        taskKind: 'profile-evidence-extraction',
        taskGroup: 'background',
        ownerRef: context.checkpoint.checkpointId,
        providerId: options.providerId,
        priority: 20,
        prompt: `${PROFILE_EVIDENCE_CAPABILITY}\n\n${serialized}`,
      });
      const task = await awaitTerminal(options.runtime, options.execution, handle.taskId);
      if (task.status !== 'completed') throw new Error('profile_evidence_generation_failed');
      const parsed = ExtractionResultSchema.parse(parseJson(task.draftMarkdown ?? ''));
      const candidates = parsed.candidates.filter(
        (candidate) => !isPausedLearningBehavior(candidate),
      );
      validateDrafts(context, candidates);
      return {
        checkpoint: context.checkpoint,
        sourceSnapshotHash: context.sourceSnapshotHash,
        analyzerVersion: options.analyzerVersion,
        extractorVersion: options.extractorVersion,
        extractedAt: options.now().toISOString(),
        candidates,
      };
    },
  };
}

export function profileEvidenceTaskFingerprint(input: unknown): string {
  const context = assembleProfileEvidenceContext(input);
  return sha256(JSON.stringify(context));
}
