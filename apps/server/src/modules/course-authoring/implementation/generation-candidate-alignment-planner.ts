import { createHash } from 'node:crypto';

import type { GenerationExecution } from '../../generation-runtime/interface.js';
import type { AuthoringContext } from '../ports/authoring-agent.js';
import type {
  CandidateAlignmentPlan,
  CandidateAlignmentPlanner,
} from '../ports/candidate-alignment-planner.js';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parsePlan(markdown: string): CandidateAlignmentPlan {
  const unfenced = markdown
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  const parsed = JSON.parse(unfenced) as Record<string, unknown>;
  if (!['clarify', 'regenerate', 'patch'].includes(String(parsed.action))) {
    throw new Error('candidate_alignment_plan_invalid');
  }
  if (typeof parsed.rationale !== 'string' || parsed.rationale.trim() === '') {
    throw new Error('candidate_alignment_plan_invalid');
  }
  if (
    !Array.isArray(parsed.targetModuleIds) ||
    parsed.targetModuleIds.some((id) => typeof id !== 'string')
  ) {
    throw new Error('candidate_alignment_plan_invalid');
  }
  return {
    action: parsed.action as CandidateAlignmentPlan['action'],
    rationale: parsed.rationale.trim(),
    targetModuleIds: [...new Set(parsed.targetModuleIds.map((id) => id.trim()).filter(Boolean))],
  };
}

function prompt(context: AuthoringContext): string {
  return [
    'COURSE_CANDIDATE_ALIGNMENT_PLAN_V1',
    'Decide how the current candidate outline should respond to the latest user turn.',
    'Use clarify when intent or desired boundary is still ambiguous; regenerate when the learning goal, audience, scope, or global structure changes; patch when a contained part can change while the rest remains coherent.',
    'Course mode is an attention bias, never a format prison. Do not reject course-adjacent exploration merely because it crosses a mode boundary.',
    'Return strict JSON only: {"action":"clarify|regenerate|patch","rationale":"...","targetModuleIds":["..."]}. Module ids may be empty when the outline does not expose stable ids.',
    '',
    JSON.stringify(context),
  ].join('\n');
}

export function createGenerationCandidateAlignmentPlanner(options: {
  execution: GenerationExecution;
  providerId: string;
}): CandidateAlignmentPlanner {
  return {
    async plan(context) {
      if (context.candidate === undefined)
        throw new Error('candidate_alignment_requires_candidate');
      const input = prompt(context);
      const task = await options.execution.submit({
        taskKey: `course-candidate-alignment:${context.outlineSessionId}:${hash(input)}`,
        inputSnapshotHash: hash(input),
        taskKind: 'outline-candidate-alignment',
        taskGroup: 'interactive',
        ownerRef: context.outlineSessionId,
        providerId: options.providerId,
        priority: 115,
        prompt: input,
      });
      const completed = await options.execution.awaitTerminal(task.taskId);
      if (completed.status !== 'completed' || completed.draftMarkdown === undefined) {
        throw Object.assign(new Error('candidate_alignment_planner_unavailable'), {
          code: 'ai_unavailable',
          taskId: task.taskId,
        });
      }
      return parsePlan(completed.draftMarkdown);
    },
  };
}
