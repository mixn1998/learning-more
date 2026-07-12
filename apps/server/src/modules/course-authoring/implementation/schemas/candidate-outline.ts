import { z } from 'zod';

export const CandidateLessonSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  coreKnowledgePoints: z.array(z.string().min(1)).min(1),
  prerequisiteLessonIds: z.array(z.string().min(1)),
  estimatedMinutes: z.number().int().min(5).max(480),
  sourceRefs: z.array(z.string().min(1)).min(1),
});

export const CandidateOutlineMetadataSchema = z.strictObject({
  courseGoals: z.array(z.string().min(1)).min(1).max(12),
  disciplineTag: z.string().min(1),
  topicTags: z.array(z.string().min(1)).min(1).max(3),
  lessons: z.array(CandidateLessonSchema).min(1).max(100),
});

export type CandidateOutlineMetadata = z.infer<typeof CandidateOutlineMetadataSchema>;
