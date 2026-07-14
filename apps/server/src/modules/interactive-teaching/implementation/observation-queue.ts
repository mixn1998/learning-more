export interface ObservationQueue {
  enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T>;
  drain(sessionId: string): Promise<void>;
}

export function createObservationQueue(): ObservationQueue {
  const tails = new Map<string, Promise<unknown>>();
  return {
    enqueue<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(sessionId) ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(work);
      tails.set(sessionId, next);
      void next.then(
        () => {
          if (tails.get(sessionId) === next) tails.delete(sessionId);
        },
        () => {
          if (tails.get(sessionId) === next) tails.delete(sessionId);
        },
      );
      return next;
    },
    async drain(sessionId: string) {
      await tails.get(sessionId);
    },
  };
}
