import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_KEYS } from '@learning-more/contracts';

import { checkDataKeys } from './check-data-keys.js';
import { checkImport, collectModuleSpecifiers, type ImportIssue } from './check-imports.js';

const sourceExtensions = new Set(['.ts', '.tsx']);
const ignoredDirectories = new Set(['dist', 'node_modules']);

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
    } else if (sourceExtensions.has(path.extname(entry.name)) && !entry.name.includes('.test.')) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function resolveRelativeImport(source: string, specifier: string): Promise<string> {
  const base = path.resolve(path.dirname(source), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    path.join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (
      await stat(candidate)
        .then(() => true)
        .catch(() => false)
    ) {
      return candidate;
    }
  }
  return base;
}

function workspaceTarget(root: string, specifier: string): string | undefined {
  if (specifier === '@learning-more/contracts') {
    return path.join(root, 'packages/contracts/src/index.ts');
  }
  if (specifier === '@learning-more/ui') {
    return path.join(root, 'packages/ui/src/index.ts');
  }
  return undefined;
}

function repositoryPath(root: string, filePath: string): string {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

async function checkRepositoryImports(root: string): Promise<ImportIssue[]> {
  const roots = ['apps', 'packages', 'tools'].map((directory) => path.join(root, directory));
  const sourceFiles = (await Promise.all(roots.map(collectSourceFiles))).flat();
  const issues: ImportIssue[] = [];

  for (const source of sourceFiles) {
    const sourceText = await readFile(source, 'utf8');
    const specifiers = collectModuleSpecifiers(sourceText, source);
    for (const specifier of specifiers) {
      const absoluteTarget = specifier.startsWith('.')
        ? await resolveRelativeImport(source, specifier)
        : workspaceTarget(root, specifier);
      const target =
        absoluteTarget === undefined ? specifier : repositoryPath(root, absoluteTarget);
      const issue = checkImport(repositoryPath(root, source), target);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
  }
  return issues;
}

type ProfileGovernanceIssue = Readonly<{
  code: 'AI_OR_UI_MUTATES_CONFIRMED_PROFILE';
  source: string;
  pattern: string;
}>;

async function checkProfileGovernance(root: string): Promise<ProfileGovernanceIssue[]> {
  const files = (
    await Promise.all(
      ['apps/server/src', 'apps/web/src'].map((directory) =>
        collectSourceFiles(path.join(root, directory)),
      ),
    )
  ).flat();
  const issues: ProfileGovernanceIssue[] = [];
  for (const source of files) {
    const repositorySource = repositoryPath(root, source);
    const text = await readFile(source, 'utf8');
    const isAiOrUiBoundary =
      repositorySource.startsWith('apps/web/src/') ||
      repositorySource.includes('/ai-providers/') ||
      /\/generation-[^/]+\.ts$/u.test(repositorySource);
    const patterns = [
      /promotionState\s*:\s*['"](?:confirmed|promoted)['"]/u,
      /saveConfirmed(?:Global)?Profile\s*\(/u,
      ...(isAiOrUiBoundary ? [/\.evidence\.save\s*\(/u] : []),
    ];
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        issues.push({
          code: 'AI_OR_UI_MUTATES_CONFIRMED_PROFILE',
          source: repositorySource,
          pattern: pattern.source,
        });
      }
    }
  }
  return issues;
}

const currentFile = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(currentFile), '../../..');
const dataKeyIssues = checkDataKeys(DATA_KEYS, 268);
const importIssues = await checkRepositoryImports(repositoryRoot);
const profileGovernanceIssues = await checkProfileGovernance(repositoryRoot);

if (dataKeyIssues.length > 0 || importIssues.length > 0 || profileGovernanceIssues.length > 0) {
  process.stderr.write(
    `${JSON.stringify({ dataKeyIssues, importIssues, profileGovernanceIssues }, null, 2)}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`${DATA_KEYS.length} dataKeys verified\n`);
  process.stdout.write('0 forbidden imports\n');
  process.stdout.write('0 forbidden AI/UI profile mutations\n');
}
