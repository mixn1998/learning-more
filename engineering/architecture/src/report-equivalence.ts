import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { EquivalenceEntry } from './check-equivalence.js';

export type ExecutedTest = Readonly<{
  filePath: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
}>;

export type ReleaseEvidenceIssue =
  | Readonly<{ code: 'UNIMPLEMENTED_EQUIVALENCE'; id: string }>
  | Readonly<{ code: 'MISSING_EQUIVALENCE_RESULT'; id: string; path: string }>
  | Readonly<{ code: 'FAILED_EQUIVALENCE_RESULT'; id: string; path: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testStatus(value: unknown): ExecutedTest['status'] {
  if (value === 'passed') return 'passed';
  if (value === 'failed' || value === 'timedOut' || value === 'interrupted') return 'failed';
  return 'skipped';
}

export function parseVitestReport(value: unknown): ExecutedTest[] {
  if (!isRecord(value) || !Array.isArray(value.testResults)) return [];
  const output: ExecutedTest[] = [];
  for (const result of value.testResults) {
    if (!isRecord(result) || typeof result.name !== 'string') continue;
    if (!Array.isArray(result.assertionResults)) continue;
    for (const assertion of result.assertionResults) {
      if (!isRecord(assertion)) continue;
      const title =
        typeof assertion.fullName === 'string'
          ? assertion.fullName
          : typeof assertion.title === 'string'
            ? assertion.title
            : undefined;
      if (title === undefined) continue;
      output.push({
        filePath: result.name,
        title,
        status: testStatus(assertion.status),
      });
    }
  }
  return output;
}

function collectPlaywrightSuites(
  suites: unknown,
  inheritedFile: string | undefined,
): ExecutedTest[] {
  if (!Array.isArray(suites)) return [];
  const output: ExecutedTest[] = [];
  for (const suite of suites) {
    if (!isRecord(suite)) continue;
    const reportedFile = typeof suite.file === 'string' ? suite.file : inheritedFile;
    const file =
      reportedFile !== undefined && !reportedFile.replaceAll('\\', '/').includes('/')
        ? `tests/e2e/${reportedFile}`
        : reportedFile;
    if (file !== undefined && Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!isRecord(spec) || typeof spec.title !== 'string' || !Array.isArray(spec.tests)) {
          continue;
        }
        for (const test of spec.tests) {
          if (!isRecord(test) || !Array.isArray(test.results)) continue;
          const lastResult = test.results.at(-1);
          output.push({
            filePath: file,
            title: spec.title,
            status: isRecord(lastResult) ? testStatus(lastResult.status) : 'skipped',
          });
        }
      }
    }
    output.push(...collectPlaywrightSuites(suite.suites, file));
  }
  return output;
}

export function parsePlaywrightReport(value: unknown): ExecutedTest[] {
  if (!isRecord(value)) return [];
  return collectPlaywrightSuites(value.suites, undefined);
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');
}

function pathMatches(actual: string, expected: string): boolean {
  const normalizedActual = normalizedPath(actual);
  const normalizedExpected = normalizedPath(expected).replace(/^\//, '');
  return (
    normalizedActual === normalizedExpected || normalizedActual.endsWith(`/${normalizedExpected}`)
  );
}

function exactIdTitle(title: string, id: string): boolean {
  return title.includes(`[${id}]`);
}

export function checkReleaseEvidence(
  entries: readonly EquivalenceEntry[],
  executedTests: readonly ExecutedTest[],
): ReleaseEvidenceIssue[] {
  const issues: ReleaseEvidenceIssue[] = [];
  for (const entry of entries) {
    if (entry.status === 'unimplemented') {
      issues.push({ code: 'UNIMPLEMENTED_EQUIVALENCE', id: entry.id });
      continue;
    }
    const matching = executedTests.filter(
      (test) =>
        pathMatches(test.filePath, entry.automatedTest) && exactIdTitle(test.title, entry.id),
    );
    if (matching.length === 0) {
      issues.push({
        code: 'MISSING_EQUIVALENCE_RESULT',
        id: entry.id,
        path: entry.automatedTest,
      });
      continue;
    }
    if (matching.some((test) => test.status !== 'passed')) {
      issues.push({
        code: 'FAILED_EQUIVALENCE_RESULT',
        id: entry.id,
        path: entry.automatedTest,
      });
    }
  }
  return issues;
}

export function createEquivalenceReport(
  entries: readonly EquivalenceEntry[],
  executedTests: readonly ExecutedTest[],
): string {
  const lines = [
    '# Learning MORE 功能等价验收报告',
    '',
    `总断言：${entries.length}；已声明通过：${entries.filter((entry) => entry.status === 'passing').length}；待实现：${entries.filter((entry) => entry.status === 'unimplemented').length}。`,
    '',
  ];
  const modules = [...new Set(entries.map((entry) => entry.ownerModule))].sort();
  for (const moduleName of modules) {
    const moduleEntries = entries.filter((entry) => entry.ownerModule === moduleName);
    lines.push(
      `## ${moduleName}`,
      '',
      '| 测试层级 | 总数 | 证据通过 | 未通过 |',
      '| --- | ---: | ---: | ---: |',
    );
    const levels = [...new Set(moduleEntries.map((entry) => entry.testLevel))].sort();
    for (const level of levels) {
      const levelEntries = moduleEntries.filter((entry) => entry.testLevel === level);
      const verified = levelEntries.filter(
        (entry) =>
          entry.status === 'passing' &&
          executedTests.some(
            (test) =>
              pathMatches(test.filePath, entry.automatedTest) &&
              exactIdTitle(test.title, entry.id) &&
              test.status === 'passed',
          ),
      ).length;
      lines.push(
        `| ${level} | ${levelEntries.length} | ${verified} | ${levelEntries.length - verified} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export function readExecutedTestReports(repositoryRoot: string): ExecutedTest[] {
  const reports = [
    { path: 'artifacts/tests/unit.json', parser: parseVitestReport },
    { path: 'artifacts/tests/playwright.json', parser: parsePlaywrightReport },
    { path: 'artifacts/tests/playwright-runtime.json', parser: parsePlaywrightReport },
  ];
  return reports.flatMap((report) => {
    const absolute = path.join(repositoryRoot, report.path);
    if (!existsSync(absolute)) return [];
    return report.parser(JSON.parse(readFileSync(absolute, 'utf8')) as unknown);
  });
}

export function writeEquivalenceReport(
  repositoryRoot: string,
  entries: readonly EquivalenceEntry[],
  executedTests: readonly ExecutedTest[],
): void {
  const output = path.join(repositoryRoot, 'artifacts', 'equivalence-report.md');
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, createEquivalenceReport(entries, executedTests), 'utf8');
}
