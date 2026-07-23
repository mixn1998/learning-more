export class FinalReviewValidationError extends Error {
  readonly code = 'candidate_invalid';
}

export function validateFinalReview(
  review: {
    markdown: string;
    sourceSessionIds: readonly string[];
    messageRangeChecksum: string;
  },
  snapshot: {
    sourceSessionIds: readonly string[];
    messageRangeChecksum: string;
  },
): void {
  if (
    review.markdown.trim() === '' ||
    /<\/?[a-z][^>]*>/i.test(review.markdown) ||
    JSON.stringify(review.sourceSessionIds) !== JSON.stringify(snapshot.sourceSessionIds) ||
    review.messageRangeChecksum !== snapshot.messageRangeChecksum
  ) {
    throw new FinalReviewValidationError('candidate_invalid');
  }
}
