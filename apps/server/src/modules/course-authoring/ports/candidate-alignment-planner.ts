import type { AuthoringContext } from './authoring-agent.js';

export type CandidateAlignmentPlan = Readonly<{
  action: 'clarify' | 'regenerate' | 'patch';
  rationale: string;
  targetModuleIds: readonly string[];
}>;

export interface CandidateAlignmentPlanner {
  plan(context: AuthoringContext): Promise<CandidateAlignmentPlan>;
}
