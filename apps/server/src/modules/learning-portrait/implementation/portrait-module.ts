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
  const stableModes = (manifest.semanticCoreInput?.modes ?? []).map((mode, index) =>
    [
      `### 稳定学习模式 ${index + 1}`,
      `模式编号：${mode.modeId}`,
      `核心结论：${mode.feature}`,
      `教学影响：${mode.teachingImpact}`,
      `适用边界：${mode.applicabilityBoundary}`,
      `独立证据会话数量：${mode.evidenceSessionCount}`,
      `可引用证据编号：${mode.evidenceIds.join('、')}`,
    ].join('\n'),
  );
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
    '只返回一个 JSON 对象：{"title":"...","summary":"...","claims":[{"claimId":"...","semanticModeId":"...","markdown":"...","evidenceIds":["..."],"confidence":0.0,"limitations":["..."],"counterEvidenceChecked":true}]}。',
    '跨会话语义核心已经完成模式归并和稳定性校验。不得重新发明、拆分或合并模式；每条 claims 必须对应一个给定 semanticModeId，且只引用该模式列出的证据编号。',
    '画像只解释稳定 observed_behavior 模式。每条正文按“核心结论 → 具体表现 → 教学建议 → 适用边界”组织，不得使用相同模板换词重复。',
    '【输出语言】',
    '所有面向学习者的 title、summary、claims.markdown 和 limitations 必须使用简体中文。必要的专有名词可以保留原文，但不得把整段学习画像写成英文。',
    '这些字段是直接展示给学习者的界面文案，不得照抄后台维度名或分析术语。必须使用“你”来描述：在什么学习情境中做了什么、这种做法可能带来什么帮助、目前还不能说明什么。',
    '把“关键依赖与链式可行性追踪”改写为“你会顺着步骤往后检查，确认前一步用掉资源后，后面的方案还能不能继续”；把“跨时间权衡与选项价值评估”改写为“做选择时，你不只看眼前结果，也会考虑以后还剩哪些选择、失败后能否恢复”。',
    'title 必须以“你”开头，直接说出一个学习者能认出的具体做法，控制在 24 个汉字左右；不要使用“学习画像、观察、洞察、证据、推理、分析”等报告标题。示例：“你会先检查步骤能不能接得上”。',
    'summary 最多两句：第一句用普通语言说明这种做法最近怎样反复出现，第二句说明它只代表当前学习记录、不代表固定性格或能力。不得写“冻结证据显示”“独立学习会话”“认知迁移”等分析报告套话。',
    '禁止在面向学习者的字段中出现 reasoning、claimDimension、sourceGroup、快照、投影、候选证据、独立来源组、复合证据、置信度、分析粒度、链式可行性、选项价值、结构化推理、依赖链追踪、跨期权衡等后台词汇。',
    '每条 claims.markdown 必须以“### 你……”形式的简短、日常语言标题开头，各条标题不得重复；正文最多两段。不要说明系统如何做分析，也不要报告证据条数。',
    '',
    '【分析边界】',
    `只解释 ${manifest.window.from} 至 ${manifest.window.to} 已校验的稳定学习模式。形成开放的、情境化的学习观察，不生成固定人格轴，也不新增或改写全局用户档案事实。`,
    '',
    '【已校验稳定学习模式】',
    stableModes.length === 0 ? '当前没有可投影的稳定学习模式。' : stableModes.join('\n\n'),
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
      semanticCoreInput?: PortraitInputManifest['semanticCoreInput'];
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
        ...(input.semanticCoreInput === undefined
          ? {}
          : { semanticCoreInput: input.semanticCoreInput }),
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
