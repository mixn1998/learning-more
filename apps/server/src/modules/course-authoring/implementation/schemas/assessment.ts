import { z } from 'zod';

export const AssessmentArtifactSchema = z.strictObject({
  summary: z.string().min(1),
  readiness: z.enum(['insufficient', 'sufficient', 'skipped']),
  evidence: z.array(
    z.strictObject({
      kind: z.enum(['user_fact', 'material_fact', 'ai_inference']),
      statement: z.string().min(1),
      sourceRef: z.string().min(1),
    }),
  ),
});

export type AssessmentArtifact = z.infer<typeof AssessmentArtifactSchema>;
