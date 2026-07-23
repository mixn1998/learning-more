import type { EventType, LearningEventEnvelope } from '@learning-more/contracts';

export type LearningEventHandler = (event: LearningEventEnvelope) => void | Promise<void>;

export interface EventDispatcher {
  register(type: EventType, handler: LearningEventHandler): () => void;
  dispatch(event: LearningEventEnvelope): Promise<void>;
}

export function createEventDispatcher(): EventDispatcher {
  const handlers = new Map<EventType, Set<LearningEventHandler>>();
  const delivered = new Set<string>();

  return {
    register(type, handler) {
      const registered = handlers.get(type) ?? new Set();
      registered.add(handler);
      handlers.set(type, registered);
      return () => registered.delete(handler);
    },
    async dispatch(event) {
      if (delivered.has(event.id)) return;
      for (const handler of handlers.get(event.type) ?? []) await handler(event);
      delivered.add(event.id);
    },
  };
}
