import type { NextLessonCandidate } from '../interface.js';

export function eligibleNextLessons(
  candidates: readonly NextLessonCandidate[],
  completedSemanticKeys: readonly string[],
): readonly NextLessonCandidate[] {
  const completed = new Set(completedSemanticKeys);
  return candidates.filter((candidate) => {
    if (completed.has(candidate.semanticKey)) return false;
    if (candidate.courseStatus === 'closed') return false;
    if (candidate.available === false) return false;
    if (candidate.progress === 'completed' || candidate.progress === 'abandoned') return false;
    if (candidate.progress === 'in_progress' || candidate.activeSession === true) return false;
    return candidate.prerequisiteSemanticKeys.every((key) => completed.has(key));
  });
}
