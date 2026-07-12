import { describe, expect, it } from 'vitest';

import { checkImport, collectModuleSpecifiers } from './check-imports.js';

describe('import boundary checks', () => {
  it('rejects imports into another module implementation', () => {
    expect(
      checkImport(
        'apps/server/src/modules/domain-a/model/x.ts',
        'apps/server/src/modules/domain-b/implementation/y.ts',
      ),
    ).toEqual({
      code: 'FORBIDDEN_IMPORT',
      rule: 'MODULE_PUBLIC_INTERFACE_ONLY',
      source: 'apps/server/src/modules/domain-a/model/x.ts',
      target: 'apps/server/src/modules/domain-b/implementation/y.ts',
    });
  });

  it('allows imports into another module public interface', () => {
    expect(
      checkImport(
        'apps/server/src/modules/review-closure/implementation/workflow.ts',
        'apps/server/src/modules/learning-session/interface.ts',
      ),
    ).toBeUndefined();
  });

  it('rejects server imports from the web app', () => {
    expect(
      checkImport(
        'apps/web/src/features/course/page.tsx',
        'apps/server/src/modules/x/interface.ts',
      ),
    ).toMatchObject({
      code: 'FORBIDDEN_IMPORT',
      rule: 'WEB_ALLOWED_DEPENDENCIES_ONLY',
    });
  });

  it.each([
    'react',
    'react-dom/client',
    'react-router-dom',
    'react-markdown',
    'rehype-sanitize',
    'vite',
    '@vitejs/plugin-react',
  ])('allows the approved web framework dependency %s', (target) => {
    expect(checkImport('apps/web/src/app.tsx', target)).toBeUndefined();
  });

  it('finds static, dynamic, and re-export module specifiers', () => {
    const source = [
      "import { a } from './a.js';",
      "export { b } from './b.js';",
      "const c = await import('./c.js');",
    ].join('\n');

    expect(collectModuleSpecifiers(source, 'fixture.ts')).toEqual(['./a.js', './b.js', './c.js']);
  });
});
