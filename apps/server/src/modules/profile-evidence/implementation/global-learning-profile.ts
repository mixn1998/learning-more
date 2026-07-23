import type { ProfileWindow } from '../interface.js';

export type { Fraction, GlobalLearningProfile, ProfileWindow } from '../interface.js';

export function validateProfileWindow(window: ProfileWindow): void {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error('global_profile_window_invalid');
  }
}
