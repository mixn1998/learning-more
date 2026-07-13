import { describe, expect, it, vi } from 'vitest';

import { createSessionWindowController } from './session-window-lifecycle.js';

describe('session window lifecycle ownership', () => {
  it('[EQ-LESSON-05] pauses for manual/close/leave/background/disconnect and auto-resumes only after background', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const controller = createSessionWindowController({ pause, resume });

    for (const event of ['manual_pause', 'window_close', 'page_leave', 'disconnect'] as const) {
      await controller.handle(event);
      await controller.handle('foreground');
    }
    expect(resume).not.toHaveBeenCalled();
    await controller.handle('background');
    await controller.handle('foreground');
    expect(resume).toHaveBeenCalledTimes(1);
    expect(pause.mock.calls.map(([reason]) => reason)).toEqual([
      'manual_pause',
      'window_close',
      'page_leave',
      'disconnect',
      'background',
    ]);
  });
});
