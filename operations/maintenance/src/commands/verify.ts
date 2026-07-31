import { verifyStore } from '../maintenance/verify-store.js';

export async function verifyCommand(arguments_: readonly string[]): Promise<number> {
  const storePath = arguments_[0];
  if (storePath === undefined) throw new Error('verify_store_path_required');
  const report = await verifyStore(storePath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.status === 'verified' ? 0 : 1;
}
