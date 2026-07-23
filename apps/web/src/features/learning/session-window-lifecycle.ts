import { useEffect, useMemo, useRef } from 'react';

export type SessionWindowEvent =
  'manual_pause' | 'window_close' | 'page_leave' | 'background' | 'foreground' | 'disconnect';

export function createSessionWindowController(options: {
  pause(reason: Exclude<SessionWindowEvent, 'foreground'>): Promise<void>;
  resume(): Promise<void>;
}) {
  let pausedByBackground = false;
  let pending = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    pending = pending.then(operation, operation);
    return pending;
  };
  return {
    handle(event: SessionWindowEvent): Promise<void> {
      return enqueue(async () => {
        if (event === 'foreground') {
          if (!pausedByBackground) return;
          pausedByBackground = false;
          await options.resume();
          return;
        }
        pausedByBackground = event === 'background';
        await options.pause(event);
      });
    },
  };
}

export function useSessionWindowLifecycle(options: {
  enabled: boolean;
  pause(reason: Exclude<SessionWindowEvent, 'foreground'>): Promise<void>;
  resume(): Promise<void>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const controller = useMemo(
    () =>
      createSessionWindowController({
        pause: (reason) =>
          latest.current.enabled ? latest.current.pause(reason) : Promise.resolve(),
        resume: () => (latest.current.enabled ? latest.current.resume() : Promise.resolve()),
      }),
    [],
  );
  useEffect(() => {
    const visibility = () => void controller.handle(document.hidden ? 'background' : 'foreground');
    const close = () => void controller.handle('window_close');
    const leave = () => void controller.handle('page_leave');
    const disconnect = () => void controller.handle('disconnect');
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', close);
    window.addEventListener('pagehide', leave);
    window.addEventListener('offline', disconnect);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', close);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('offline', disconnect);
    };
  }, [controller]);
}
