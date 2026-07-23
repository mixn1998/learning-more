export type PortraitRefreshRequest = Readonly<{
  idempotencyKey: string;
  tokenBudget: number;
}>;

export function createPortraitRefreshCoordinator<Result>(options: {
  perform(request: PortraitRefreshRequest): Promise<Result>;
}) {
  let barrier: Promise<void> = Promise.resolve();

  return {
    request(request: PortraitRefreshRequest): Promise<Result> {
      const result = barrier.then(() => options.perform(request));
      barrier = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
