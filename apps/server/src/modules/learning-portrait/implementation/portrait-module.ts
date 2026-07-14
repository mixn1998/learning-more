import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidence } from '../../profile-evidence/interface.js';
import type {
  PackedPortraitEvidence,
  PortraitEvidenceSource,
  PortraitInputManifest,
  PortraitVersion,
} from '../interface.js';
import type { PortraitRepository } from '../ports/portrait-repository.js';
import { createPortraitInputManifest } from './portrait-input-manifest.js';
import { validatePortraitOutput } from './portrait-validator.js';

function sourceGroupLabel(group: CandidateEvidence['sourceGroup']): string {
  if (group === 'behavior') return '学习行为';
  if (group === 'outcome') return '学习结果';
  if (group === 'reflection') return '学习反思';
  if (group === 'planning') return '计划与执行';
  return 'Review';
}

function polarityLabel(polarity: CandidateEvidence['polarity']): string {
  if (polarity === 'supporting') return '支持性证据';
  if (polarity === 'limiting') return '限制性证据';
  return '反向或矛盾证据';
}

function renderPortraitEvidence(
  manifest: PortraitInputManifest,
  evidence: readonly CandidateEvidence[],
): string {
  const entries = evidence.map((candidate, index) =>
    [
      `### 学习证据 ${index + 1}`,
      `证据编号：${candidate.evidenceId}`,
      `观察时间：${candidate.observedAt}`,
      `证据来源类型：${sourceGroupLabel(candidate.sourceGroup)}`,
      `证据方向：${polarityLabel(candidate.polarity)}`,
      `观察主题：${candidate.claimDimension.replace(/[._-]+/gu, ' ')}`,
      `观察内容：${candidate.summary}`,
      `证据强度：${candidate.strength.score}/3；${candidate.strength.rationale}`,
    ].join('\n'),
  );
  return [
    '【机器输出契约】',
    '只返回一个 JSON 对象：{"title":"...","summary":"...","claims":[{"claimId":"...","markdown":"...","evidenceIds":["..."],"confidence":0.0,"limitations":["..."],"counterEvidenceChecked":true}]}。',
    '每条 claims 必须引用至少两个满足独立来源规则的可用证据编号；没有足够证据时允许返回空 claims。',
    '【输出语言】',
    '所有面向学习者的 title、summary、claims.markdown 和 limitations 必须使用简体中文。必要的专有名词可以保留原文，但不得把整段学习画像写成英文。',
    '',
    '【分析边界】',
    `只分析 ${manifest.window.from} 至 ${manifest.window.to} 的冻结证据。形成开放的、情境化的学习观察，不生成固定人格轴，也不新增或改写全局用户档案事实。`,
    '',
    '【可用学习证据】',
    entries.length === 0 ? '当前没有满足纳入规则的学习证据。' : entries.join('\n\n'),
  ].join('\n');
}

export function createPortraitModule(options: {
  repository: PortraitRepository;
  evidenceRepository: PortraitEvidenceSource;
  unitOfWork: UnitOfWork;
  generationRuntime: {
    submit(request: {
      taskKey: string;
      inputSnapshotHash: string;
      taskKind: string;
      taskGroup: 'background';
      ownerRef: string;
      providerId: string;
      priority: number;
      prompt: string;
    }): Promise<{ taskId: string }>;
  };
  providerId?: string;
  nextVersionId(): string;
  nextTransactionId(): string;
  now(): Date;
  recordCreated?(
    event: Readonly<{ type: 'PortraitVersionCreated'; versionId: string; manifestId: string }>,
    tx: TransactionContext,
  ): Promise<void>;
}) {
  async function submitPrepared(version: PortraitVersion): Promise<PortraitVersion> {
    if (version.state !== 'preparing') return version;
    const manifest = await options.repository.getManifest(version.manifestId);
    if (manifest === undefined) throw new Error('PORTRAIT_MANIFEST_NOT_FOUND');
    const evidence = [];
    for (const evidenceId of manifest.includedEvidenceIds) {
      const candidate = await options.evidenceRepository.get(evidenceId);
      if (candidate !== undefined) evidence.push(candidate);
    }
    const evidenceBackground = renderPortraitEvidence(manifest, evidence);
    const task = await options.generationRuntime.submit({
      taskKey: `portrait:${manifest.manifestId}`,
      inputSnapshotHash: manifest.manifestChecksum,
      taskKind: 'learning-portrait',
      taskGroup: 'background',
      ownerRef: version.versionId,
      providerId: options.providerId ?? 'current',
      priority: 10,
      prompt: evidenceBackground,
    });
    const timestamp = options.now().toISOString();
    await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
      options.repository.saveVersion(
        tx,
        {
          ...version,
          state: 'generating',
          generationTaskId: task.taskId,
          updatedAt: timestamp,
        },
        version.resourceVersion,
      ),
    );
    return (await options.repository.getVersion(version.versionId))!;
  }

  return {
    async requestRefresh(input: {
      profileVersion: number;
      packedEvidence: PackedPortraitEvidence;
      window: Readonly<{ from: string; to: string }>;
      promptTemplateVersion: string;
      providerConfigFingerprint: string;
      reasoningBehaviorInput?: Readonly<{
        snapshotId: string;
        sourceSnapshotHash: string;
        dimensionSetVersion: string;
      }>;
      idempotencyKey: string;
    }) {
      const existingReceipt = await options.repository.getReceipt(input.idempotencyKey);
      if (existingReceipt !== undefined) {
        const existingVersion = await options.repository.getVersion(existingReceipt.versionId);
        if (existingVersion === undefined) throw new Error('PORTRAIT_RECEIPT_DANGLING');
        return submitPrepared(existingVersion);
      }
      const timestamp = options.now().toISOString();
      const manifest = createPortraitInputManifest({
        profileVersion: input.profileVersion,
        packedEvidence: input.packedEvidence,
        window: input.window,
        promptTemplateVersion: input.promptTemplateVersion,
        providerConfigFingerprint: input.providerConfigFingerprint,
        ...(input.reasoningBehaviorInput === undefined
          ? {}
          : { reasoningBehaviorInput: input.reasoningBehaviorInput }),
        createdAt: timestamp,
      });
      const versionId = options.nextVersionId();
      await options.unitOfWork.execute(
        { transactionId: options.nextTransactionId() },
        async (tx) => {
          await options.repository.saveManifest(tx, manifest);
          await options.repository.saveVersion(
            tx,
            {
              versionId,
              manifestId: manifest.manifestId,
              state: 'preparing',
              claims: [],
              createdAt: timestamp,
              updatedAt: timestamp,
              resourceVersion: 0,
            },
            0,
          );
          await options.repository.saveReceipt(tx, {
            idempotencyKey: input.idempotencyKey,
            versionId,
            manifestId: manifest.manifestId,
            createdAt: timestamp,
          });
        },
      );
      return submitPrepared((await options.repository.getVersion(versionId))!);
    },

    async finalize(versionId: string, taskId: string, output: unknown) {
      const current = await options.repository.getVersion(versionId);
      if (current === undefined) throw new Error('PORTRAIT_VERSION_NOT_FOUND');
      if (current.state === 'completed') return current;
      if (current.state !== 'generating' || current.generationTaskId !== taskId) {
        throw new Error('PORTRAIT_TASK_STALE');
      }
      const manifest = await options.repository.getManifest(current.manifestId);
      if (manifest === undefined) throw new Error('PORTRAIT_MANIFEST_NOT_FOUND');
      const evidence = [];
      for (const evidenceId of manifest.includedEvidenceIds) {
        const candidate = await options.evidenceRepository.get(evidenceId);
        if (candidate !== undefined) evidence.push(candidate);
      }
      const validated = validatePortraitOutput({ output, manifest, evidence });
      const localized =
        validated.claims.length === 0
          ? {
              title: '学习画像：证据尚不足',
              summary:
                '当前冻结的证据尚不足以形成可独立验证的学习观察，因此暂不生成稳定结论。后续学习、复盘或补充对话积累到足够的可追溯证据后，画像会再更新；这不会改写全局用户档案中的长期事实。',
              claims: [],
            }
          : validated;
      const timestamp = options.now().toISOString();
      const cursor = await options.repository.getCurrent();
      await options.unitOfWork.execute(
        { transactionId: options.nextTransactionId() },
        async (tx) => {
          await options.repository.saveVersion(
            tx,
            {
              ...current,
              state: 'completed',
              title: localized.title,
              summary: localized.summary,
              claims: localized.claims,
              completedAt: timestamp,
              updatedAt: timestamp,
            },
            current.resourceVersion,
          );
          await options.repository.saveCurrent(
            tx,
            {
              currentVersionId: versionId,
              updatedAt: timestamp,
              resourceVersion: cursor?.resourceVersion ?? 0,
            },
            cursor?.resourceVersion ?? 0,
          );
          await options.recordCreated?.(
            { type: 'PortraitVersionCreated', versionId, manifestId: current.manifestId },
            tx,
          );
        },
      );
      return (await options.repository.getVersion(versionId))!;
    },

    async fail(versionId: string, taskId: string, errorCode: string, draftArtifactRef: string) {
      const current = await options.repository.getVersion(versionId);
      if (current === undefined) throw new Error('PORTRAIT_VERSION_NOT_FOUND');
      if (current.state === 'completed') return current;
      if (current.state !== 'generating' || current.generationTaskId !== taskId) {
        throw new Error('PORTRAIT_TASK_STALE');
      }
      await options.unitOfWork.execute({ transactionId: options.nextTransactionId() }, (tx) =>
        options.repository.saveVersion(
          tx,
          {
            ...current,
            state: 'failed',
            errorCode,
            draftArtifactRef,
            updatedAt: options.now().toISOString(),
          },
          current.resourceVersion,
        ),
      );
      return (await options.repository.getVersion(versionId))!;
    },
  };
}
