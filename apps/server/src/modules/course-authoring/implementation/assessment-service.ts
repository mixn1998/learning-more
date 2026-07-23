import { AssessmentArtifactSchema, type AssessmentArtifact } from './schemas/assessment.js';

export type AssessmentCompilationResult =
  | Readonly<{ valid: true; artifact: AssessmentArtifact }>
  | Readonly<{ valid: false; issues: readonly { path: string; message: string }[] }>;

export function compileAssessment(
  draft: unknown,
  manifest: { readonly allowedSourceRefs: readonly string[] },
): AssessmentCompilationResult {
  const parsed = AssessmentArtifactSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const issues: { path: string; message: string }[] = [];
  for (const [index, evidence] of parsed.data.evidence.entries()) {
    const expectedPrefix =
      evidence.kind === 'user_fact'
        ? 'user:'
        : evidence.kind === 'material_fact'
          ? 'material:'
          : 'ai:';
    if (!evidence.sourceRef.startsWith(expectedPrefix)) {
      issues.push({
        path: `evidence.${index}.sourceRef`,
        message: `${evidence.kind} 必须使用 ${expectedPrefix} 来源`,
      });
    }
    if (!manifest.allowedSourceRefs.includes(evidence.sourceRef)) {
      issues.push({ path: `evidence.${index}.sourceRef`, message: '未知 assessment sourceRef' });
    }
  }
  return issues.length > 0 ? { valid: false, issues } : { valid: true, artifact: parsed.data };
}
