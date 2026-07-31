import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8');
}

describe('local application composition boundaries', () => {
  const facade = source('apps/server/src/bootstrap/local-application.ts');
  const assembly = source('apps/server/src/bootstrap/local-application/assemble.ts');
  const runtimeFiles = [
    'course-runtime.ts',
    'event-facts-runtime.ts',
    'foundation.ts',
    'generation-runtime.ts',
    'home-runtime.ts',
    'insights-runtime.ts',
    'learning-runtime.ts',
    'next-lesson-refresh.ts',
    'planning-runtime.ts',
    'profile-runtime.ts',
    'readiness.ts',
    'review-runtime.ts',
  ];
  const runtimeLineBudgets = new Map([
    ['learning-runtime.ts', 675],
    ['profile-runtime.ts', 850],
    ['review-runtime.ts', 750],
  ]);

  it('keeps the public facade and assembly within their complexity budgets', () => {
    expect(facade.split(/\r?\n/u).length).toBeLessThanOrEqual(160);
    expect(assembly.split(/\r?\n/u).length).toBeLessThanOrEqual(400);
    for (const file of runtimeFiles) {
      const runtime = source(`apps/server/src/bootstrap/local-application/${file}`);
      expect(runtime.split(/\r?\n/u).length, file).toBeLessThanOrEqual(
        runtimeLineBudgets.get(file) ?? 650,
      );
    }
  });

  it('keeps persistence and domain implementation details out of facade and assembly', () => {
    expect(facade).not.toMatch(/modules\/.*\/implementation|persistence\//u);
    expect(assembly).not.toMatch(/modules\/.*\/implementation|persistence\//u);
    expect(assembly).not.toMatch(
      /for await|AppendUserMessage|SchedulePlanned|PortraitVersionCommitted/u,
    );
    const imports = [...assembly.matchAll(/from '([^']+)'/gu)]
      .map((match) => match[1])
      .filter((entry): entry is string => entry !== undefined);
    expect(
      imports.every(
        (entry) =>
          entry.startsWith('./') ||
          entry === '../app.js' ||
          entry === '../../environment/request-access.js',
      ),
    ).toBe(true);
  });

  it('keeps the public interface stable and delegates each route group to its owning runtime', () => {
    expect(facade).toContain(
      "export { assembleLocalApplication as createLocalApplication } from './local-application/assemble.js';",
    );
    expect(assembly).toContain('courseAuthoring: course.routes');
    expect(assembly).toContain('learningSession: learning.routes');
    expect(assembly).toContain('learningNotes');
    expect(assembly).toContain('reviewClosure: review.routes');
    expect(assembly).toContain('planning: planningRuntime.routes');
    expect(assembly).toContain('learningFacts: {');
    expect(assembly).toContain('...insights.routes');
    expect(assembly).toContain('profile: profile.profileRoutes');
    expect(assembly).not.toContain('portraitRoutes');
    expect(assembly).toContain('runtimeControl: generation.runtimeControl');
  });
});
