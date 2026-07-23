import { describe, expect, it, vi } from 'vitest';

import { createCommandAttemptRegistry } from './use-command-attempt.js';

describe('command attempt registry', () => {
  it('reuses idempotency identity across retries and rotates only after completion', () => {
    let sequence = 0;
    const create = vi.fn(() => ({
      pageInstanceId: 'page_01',
      idempotencyKey: `idem_${++sequence}`,
    }));
    const registry = createCommandAttemptRegistry(create);
    expect(registry.attemptFor('provider-switch')).toBe(registry.attemptFor('provider-switch'));
    registry.complete('provider-switch');
    expect(registry.attemptFor('provider-switch').idempotencyKey).toBe('idem_2');
  });
});
