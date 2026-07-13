import path from 'node:path';

import { doctorStore } from '../maintenance/doctor.js';
import { quarantineIssues, repairDerivedIssues } from '../maintenance/quarantine.js';

export async function doctorCommand(arguments_: readonly string[]): Promise<number> {
  const storePath = arguments_.find((argument) => !argument.startsWith('--'));
  if (storePath === undefined) throw new Error('doctor_store_path_required');
  const resolved = path.resolve(storePath);
  const report = await doctorStore(resolved);
  const repair = arguments_.includes('--repair-derived')
    ? await repairDerivedIssues({ storePath: resolved, report })
    : undefined;
  const quarantine =
    repair === undefined && arguments_.includes('--quarantine')
      ? await quarantineIssues({ storePath: resolved, report })
      : undefined;
  process.stdout.write(`${JSON.stringify({ ...report, quarantine, repair })}\n`);
  const classification = repair?.report.classification ?? report.classification;
  return classification === 'healthy' || classification === 'repairable-derived' ? 0 : 1;
}
