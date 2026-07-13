import { useRef } from 'react';

import { createCommandAttempt, type CommandAttempt } from '../client/api-client.js';

export interface CommandAttemptRegistry {
  attemptFor(commandKey: string): CommandAttempt;
  complete(commandKey: string): void;
}

export function createCommandAttemptRegistry(
  create: () => CommandAttempt = createCommandAttempt,
): CommandAttemptRegistry {
  const attempts = new Map<string, CommandAttempt>();
  return {
    attemptFor(commandKey) {
      const existing = attempts.get(commandKey);
      if (existing !== undefined) return existing;
      const attempt = create();
      attempts.set(commandKey, attempt);
      return attempt;
    },
    complete(commandKey) {
      attempts.delete(commandKey);
    },
  };
}

export function useCommandAttempts(): CommandAttemptRegistry {
  const registry = useRef<CommandAttemptRegistry>(undefined);
  registry.current ??= createCommandAttemptRegistry();
  return registry.current;
}
