import type { VerificationIssue } from './schema-registry.js';
import { verifyStore } from './verify-store.js';

export type DoctorClassification =
  'healthy' | 'repairable-derived' | 'requires-restore' | 'unsupported';

export type DoctorReport = Readonly<{
  classification: DoctorClassification;
  writeProtectionRequired: boolean;
  issues: readonly VerificationIssue[];
  actions: readonly string[];
  checkedFiles: number;
}>;

function normalized(relativePath: string | undefined): string {
  return (relativePath ?? '').replaceAll('\\', '/');
}

function isDerived(issue: VerificationIssue): boolean {
  if (issue.code === 'outbox_receipt_event_missing' || issue.code === 'outbox_receipt_invalid') {
    return false;
  }
  const relativePath = normalized(issue.path);
  return (
    relativePath.startsWith('read-models/') ||
    relativePath.startsWith('indexes/') ||
    relativePath.startsWith('work/') ||
    relativePath.startsWith('outbox/receipts/')
  );
}

function repairActions(issues: readonly VerificationIssue[]): readonly string[] {
  const actions = new Set<string>();
  for (const issue of issues) {
    const relativePath = normalized(issue.path);
    if (relativePath.startsWith('read-models/')) actions.add('rebuild:read-models');
    if (relativePath.startsWith('indexes/')) actions.add('rebuild:indexes');
    if (relativePath.startsWith('work/')) actions.add('discard:work');
    if (relativePath.startsWith('outbox/receipts/')) actions.add('reconcile:outbox-receipts');
  }
  return [...actions].sort();
}

export async function doctorStore(storePath: string): Promise<DoctorReport> {
  const verification = await verifyStore(storePath);
  if (verification.status === 'verified') {
    return {
      classification: 'healthy',
      writeProtectionRequired: false,
      issues: verification.issues,
      actions: [],
      checkedFiles: verification.checkedFiles,
    };
  }
  if (verification.status === 'unsupported') {
    return {
      classification: 'unsupported',
      writeProtectionRequired: true,
      issues: verification.issues,
      actions: ['upgrade:application'],
      checkedFiles: verification.checkedFiles,
    };
  }
  const derivedOnly = verification.issues.length > 0 && verification.issues.every(isDerived);
  return {
    classification: derivedOnly ? 'repairable-derived' : 'requires-restore',
    writeProtectionRequired: true,
    issues: verification.issues,
    actions: derivedOnly ? repairActions(verification.issues) : ['restore:verified-backup'],
    checkedFiles: verification.checkedFiles,
  };
}
