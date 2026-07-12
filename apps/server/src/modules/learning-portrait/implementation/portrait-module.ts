import type { TransactionContext, UnitOfWork } from '../../../persistence/unit-of-work.js';
import type { CandidateEvidenceRepository } from '../../profile-evidence/ports/evidence-repository.js';
import type { PackedPortraitEvidence, PortraitVersion } from '../interface.js';
import type { PortraitRepository } from '../ports/portrait-repository.js';
import { createPortraitInputManifest } from './portrait-input-manifest.js';
import { validatePortraitOutput } from './portrait-validator.js';

export function createPortraitModule(options: {
  repository: PortraitRepository;
  evidenceRepository: CandidateEvidenceRepository;
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
    const task = await options.generationRuntime.submit({
      taskKey: `portrait:${manifest.manifestId}`,
      inputSnapshotHash: manifest.manifestChecksum,
      taskKind: 'learning-portrait',
      taskGroup: 'background',
      ownerRef: version.versionId,
      providerId: options.providerId ?? 'current',
      priority: 10,
      prompt: JSON.stringify({
        templateRef: manifest.promptTemplateVersion,
        manifestRef: manifest.manifestId,
      }),
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
              title: validated.title,
              summary: validated.summary,
              claims: validated.claims,
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
