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
  '只分析给定受控检查点中的净化片段，提取中性、局部、可撤回的候选证据。',
  'claimDimension 与 label 必须从本次行为证据中开放生成；逻辑、关联、发散、结构、隐喻只是可能示例，不是固定维度表。',
  '每项必须引用输入中真实存在的 sourceRefs，并说明限制；证据不足时返回空 candidates。',
  '不得推断人格、智力或能力等级、敏感属性、医学结论、政治宗教倾向，也不得把局部表现写成永久学习风格。',
  '不得确认或改写全局用户档案；只返回 JSON：{candidates:[{candidateKind,claimDimension,label,summary,explicitness,sourceRefs,confidence,qualityFlags,limitations,safetyStatus,blockedReason?,polarity,contradictionEvidenceIds,expiryPolicy}]}。',
].join('\n');

const ExtractionResultSchema = z.strictObject({
  candidates: z.array(ProfileEvidenceExtractionDraftSchema).max(24),
});

const FORBIDDEN_INFERENCE =
  /(?:人格|性格|智商|IQ|永久|天生|固定学习风格|能力等级|政治倾向|宗教|种族|民族|性取向|医学诊断|精神疾病|personality|intelligence|political|religion|ethnicity|sexual orientation|medical diagnosis)/iu;

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
      validateDrafts(context, parsed.candidates);
      return {
        checkpoint: context.checkpoint,
        sourceSnapshotHash: context.sourceSnapshotHash,
        analyzerVersion: options.analyzerVersion,
        extractorVersion: options.extractorVersion,
        extractedAt: options.now().toISOString(),
        candidates: parsed.candidates,
      };
    },
  };
}

export function profileEvidenceTaskFingerprint(input: unknown): string {
  const context = assembleProfileEvidenceContext(input);
  return sha256(JSON.stringify(context));
}
