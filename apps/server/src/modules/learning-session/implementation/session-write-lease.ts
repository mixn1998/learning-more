export type SessionWriteLease = Readonly<{
  token: string;
  pageInstanceId: string;
  instanceId: string;
  generation: number;
  heartbeatAt: string;
  visibilityState: 'visible' | 'hidden';
}>;

export function acquireSessionWriteLease(
  current: SessionWriteLease | undefined,
  request: {
    pageInstanceId: string;
    instanceId: string;
    token: string;
    now: Date;
  },
): { lease: SessionWriteLease; writable: boolean } {
  if (current !== undefined && current.pageInstanceId !== request.pageInstanceId) {
    return { lease: current, writable: false };
  }
  return {
    writable: true,
    lease: {
      token: current?.token ?? request.token,
      pageInstanceId: request.pageInstanceId,
      instanceId: request.instanceId,
      generation: current?.generation ?? 1,
      heartbeatAt: request.now.toISOString(),
      visibilityState: 'visible',
    },
  };
}

export function ownsWriteLease(
  lease: SessionWriteLease | undefined,
  pageInstanceId: string | undefined,
): boolean {
  return (
    lease !== undefined && pageInstanceId !== undefined && lease.pageInstanceId === pageInstanceId
  );
}

export function transferSessionWriteLease(
  current: SessionWriteLease,
  request: { pageInstanceId: string; instanceId: string; token: string; now: Date },
): SessionWriteLease {
  return {
    token: request.token,
    pageInstanceId: request.pageInstanceId,
    instanceId: request.instanceId,
    generation: current.generation + 1,
    heartbeatAt: request.now.toISOString(),
    visibilityState: 'visible',
  };
}
