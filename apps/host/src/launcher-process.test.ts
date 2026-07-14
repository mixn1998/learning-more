import { describe, expect, it } from 'vitest';

import { commandMatchesLauncher } from './launcher-process.js';

describe('commandMatchesLauncher', () => {
  it('accepts the direct Launcher entry and the verified workspace wrapper', () => {
    const launcherEntry = 'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js';
    const wrapperEntry = 'tools\\start-learning-more.mjs';

    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" "D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js"',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
    expect(
      commandMatchesLauncher(
        '"C:\\Program Files\\nodejs\\node.exe" tools/start-learning-more.mjs',
        [launcherEntry, wrapperEntry],
      ),
    ).toBe(true);
  });

  it('rejects an unrelated Node process', () => {
    expect(
      commandMatchesLauncher('node unrelated-script.mjs', [
        'D:\\workspace\\Learning MORE\\apps\\launcher\\dist\\main.js',
      ]),
    ).toBe(false);
  });
});
