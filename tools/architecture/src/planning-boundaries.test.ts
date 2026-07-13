import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Planning backend boundaries', () => {
  it('[ARCH-PLANNING-01] uses the three-state planning view and a plannable-lesson seam', () => {
    const root = process.cwd();
    const policy = readFileSync(
      path.join(root, 'apps/server/src/modules/planning/implementation/scheduling-policy.ts'),
      'utf8',
    );
    const planning = readFileSync(
      path.join(root, 'apps/server/src/modules/planning/implementation/planning-module.ts'),
      'utf8',
    );
    const planFlow = readFileSync(
      path.join(root, 'apps/server/src/modules/planning/implementation/plan-flow-service.ts'),
      'utf8',
    );

    expect(policy).toContain("'unplanned' | 'planned' | 'overdue'");
    expect(policy).not.toContain('DerivedScheduleStatus');
    expect(policy).not.toContain('deriveScheduleStatus(');
    expect(planning).toContain('getLessonProgress');
    expect(planFlow).toContain('lessonIsPlannable');
    expect(`${planning}\n${planFlow}`).not.toContain('lessonExists');
  });
});
