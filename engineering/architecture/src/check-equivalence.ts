import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import {
  checkReleaseEvidence,
  readExecutedTestReports,
  writeEquivalenceReport,
} from './report-equivalence.js';

export const EQUIVALENCE_OWNER_MODULES = [
  'CourseAuthoring',
  'LearningSession',
  'ReviewClosure',
  'Planning',
  'LearningFacts',
  'LearningNotes',
  'ProfileEvidence',
  'GenerationRuntime',
] as const;

export const EQUIVALENCE_TEST_LEVELS = [
  'domain',
  'repository',
  'module',
  'http',
  'react',
  'e2e',
  'architecture',
  'recovery',
] as const;

export type EquivalenceOwnerModule = (typeof EQUIVALENCE_OWNER_MODULES)[number];
export type EquivalenceTestLevel = (typeof EQUIVALENCE_TEST_LEVELS)[number];
export type EquivalenceStatus = 'unimplemented' | 'passing';

export type EquivalenceEntry = Readonly<{
  id: string;
  sourceHeading: string;
  assertion: string;
  ownerModule: EquivalenceOwnerModule;
  testLevel: EquivalenceTestLevel;
  automatedTest: string;
  status: EquivalenceStatus;
}>;

export type EquivalenceSourceEntry = Readonly<{
  id: string;
  sourceHeading: string;
  assertion: string;
}>;

export type EquivalenceIssue =
  | Readonly<{ code: 'COUNT_MISMATCH'; expected: number; actual: number }>
  | Readonly<{ code: 'MISSING_FIELD'; index: number; field: keyof EquivalenceEntry }>
  | Readonly<{ code: 'UNKNOWN_FIELD'; index: number; field: string }>
  | Readonly<{ code: 'INVALID_ID'; index: number; id: string }>
  | Readonly<{ code: 'INVALID_OWNER_MODULE'; id: string; ownerModule: string }>
  | Readonly<{ code: 'INVALID_TEST_LEVEL'; id: string; testLevel: string }>
  | Readonly<{ code: 'INVALID_STATUS'; id: string; status: string }>
  | Readonly<{ code: 'DUPLICATE_ID'; id: string }>
  | Readonly<{ code: 'MISSING_AUTOMATED_TEST'; id: string; path: string }>
  | Readonly<{ code: 'MATRIX_MISSING_SOURCE_ID'; id: string }>
  | Readonly<{ code: 'UNKNOWN_SOURCE_ID'; id: string }>
  | Readonly<{ code: 'SOURCE_HEADING_MISMATCH'; id: string }>
  | Readonly<{ code: 'SOURCE_ASSERTION_MISMATCH'; id: string }>;

const requiredFields = [
  'id',
  'sourceHeading',
  'assertion',
  'ownerModule',
  'testLevel',
  'automatedTest',
  'status',
] as const satisfies readonly (keyof EquivalenceEntry)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function checkEquivalence(
  entries: readonly unknown[],
  expectedCount = 75,
  fileExists: (filePath: string) => boolean = existsSync,
): EquivalenceIssue[] {
  const issues: EquivalenceIssue[] = [];
  const ids = new Set<string>();

  if (entries.length !== expectedCount) {
    issues.push({ code: 'COUNT_MISMATCH', expected: expectedCount, actual: entries.length });
  }

  entries.forEach((unknownEntry, index) => {
    if (!isRecord(unknownEntry)) {
      for (const field of requiredFields) issues.push({ code: 'MISSING_FIELD', index, field });
      return;
    }

    for (const field of Object.keys(unknownEntry)) {
      if (!requiredFields.includes(field as keyof EquivalenceEntry)) {
        issues.push({ code: 'UNKNOWN_FIELD', index, field });
      }
    }
    for (const field of requiredFields) {
      if (!nonEmptyString(unknownEntry[field])) {
        issues.push({ code: 'MISSING_FIELD', index, field });
      }
    }

    const id = unknownEntry.id;
    if (!nonEmptyString(id)) return;
    if (!/^EQ-[A-Z0-9]+-[0-9]{2}$/.test(id)) issues.push({ code: 'INVALID_ID', index, id });
    if (ids.has(id)) issues.push({ code: 'DUPLICATE_ID', id });
    ids.add(id);

    const ownerModule = unknownEntry.ownerModule;
    if (
      nonEmptyString(ownerModule) &&
      !EQUIVALENCE_OWNER_MODULES.includes(ownerModule as EquivalenceOwnerModule)
    ) {
      issues.push({ code: 'INVALID_OWNER_MODULE', id, ownerModule });
    }

    const testLevel = unknownEntry.testLevel;
    if (
      nonEmptyString(testLevel) &&
      !EQUIVALENCE_TEST_LEVELS.includes(testLevel as EquivalenceTestLevel)
    ) {
      issues.push({ code: 'INVALID_TEST_LEVEL', id, testLevel });
    }

    const status = unknownEntry.status;
    if (nonEmptyString(status) && status !== 'unimplemented' && status !== 'passing') {
      issues.push({ code: 'INVALID_STATUS', id, status });
    }

    const automatedTest = unknownEntry.automatedTest;
    if (status === 'passing' && nonEmptyString(automatedTest) && !fileExists(automatedTest)) {
      issues.push({ code: 'MISSING_AUTOMATED_TEST', id, path: automatedTest });
    }
  });

  return issues;
}

export function readEquivalenceMatrix(filePath: string): unknown[] {
  const parsed: unknown = parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(parsed)) throw new TypeError('Equivalence matrix root must be a YAML array');
  return parsed;
}

export function extractEquivalenceSource(markdown: string): EquivalenceSourceEntry[] {
  const entries: EquivalenceSourceEntry[] = [];
  const rowPattern = /^\|\s*(EQ-[A-Z0-9]+-[0-9]{2})\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/gm;
  for (const match of markdown.matchAll(rowPattern)) {
    const [, id, sourceHeading, assertion] = match;
    if (id !== undefined && sourceHeading !== undefined && assertion !== undefined) {
      entries.push({ id, sourceHeading, assertion });
    }
  }
  return entries;
}

export function checkEquivalenceSource(
  entries: readonly unknown[],
  sourceEntries: readonly EquivalenceSourceEntry[],
): EquivalenceIssue[] {
  const issues: EquivalenceIssue[] = [];
  const matrix = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    if (isRecord(entry) && nonEmptyString(entry.id)) matrix.set(entry.id, entry);
  }
  const source = new Map(sourceEntries.map((entry) => [entry.id, entry]));

  for (const sourceEntry of sourceEntries) {
    const matrixEntry = matrix.get(sourceEntry.id);
    if (matrixEntry === undefined) {
      issues.push({ code: 'MATRIX_MISSING_SOURCE_ID', id: sourceEntry.id });
      continue;
    }
    if (matrixEntry.sourceHeading !== sourceEntry.sourceHeading) {
      issues.push({ code: 'SOURCE_HEADING_MISMATCH', id: sourceEntry.id });
    }
    if (matrixEntry.assertion !== sourceEntry.assertion) {
      issues.push({ code: 'SOURCE_ASSERTION_MISMATCH', id: sourceEntry.id });
    }
  }
  for (const id of matrix.keys()) {
    if (!source.has(id)) issues.push({ code: 'UNKNOWN_SOURCE_ID', id });
  }
  return issues;
}

export function runEquivalenceCheck(
  repositoryRoot: string,
  options: Readonly<{ release?: boolean }> = {},
): number {
  const matrixPath = path.join(
    repositoryRoot,
    'engineering/architecture/fixtures/equivalence-matrix.yaml',
  );
  const sourcePath = path.join(
    repositoryRoot,
    'engineering/architecture/fixtures/equivalence-baseline.md',
  );
  const entries = readEquivalenceMatrix(matrixPath);
  const sourceEntries = extractEquivalenceSource(readFileSync(sourcePath, 'utf8'));
  const issues: unknown[] = [
    ...checkEquivalence(entries, 71, (testPath) =>
      existsSync(path.resolve(repositoryRoot, testPath)),
    ),
    ...checkEquivalenceSource(entries, sourceEntries),
  ];
  const validEntries = entries.filter(isRecord) as unknown as EquivalenceEntry[];
  const executedTests = options.release ? readExecutedTestReports(repositoryRoot) : [];
  if (options.release) {
    issues.push(...checkReleaseEvidence(validEntries, executedTests));
    writeEquivalenceReport(repositoryRoot, validEntries, executedTests);
  }
  if (issues.length > 0) {
    process.stderr.write(`${JSON.stringify({ issues }, null, 2)}\n`);
    return 1;
  }

  const passing = entries.filter((entry) => isRecord(entry) && entry.status === 'passing').length;
  process.stdout.write(
    `${entries.length} assertions verified; ${passing} passing; ${entries.length - passing} unimplemented\n`,
  );
  return 0;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const currentFile = fileURLToPath(import.meta.url);
  const repositoryRoot = path.resolve(path.dirname(currentFile), '../../..');
  process.exitCode = runEquivalenceCheck(repositoryRoot, {
    release: process.argv.includes('--release'),
  });
}
