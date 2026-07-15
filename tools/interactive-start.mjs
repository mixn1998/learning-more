import { spawn } from 'node:child_process';

export function openApplicationUrl(url, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function parseInteractiveStartArguments(arguments_) {
  if (arguments_.length === 0) return { open: false };
  if (arguments_.length === 1 && arguments_[0] === '--open') return { open: true };
  throw new Error(`interactive_start_arguments_invalid:${arguments_.join(',')}`);
}

export async function runInteractiveStart(options) {
  const command = parseInteractiveStartArguments(options.arguments_);
  const launcher = await options.startLauncher();
  if (!command.open) return { launcher, exitCode: 0 };
  try {
    await options.openUrl(options.webUrl);
    return { launcher, exitCode: 0 };
  } catch {
    return { launcher, exitCode: 1 };
  }
}
