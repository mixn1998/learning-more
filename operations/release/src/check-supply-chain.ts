import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateLicenses } from './license-policy.js';
import { scanProductionDependencyGraph } from './sbom.js';
import {
  evaluateVulnerabilities,
  parsePnpmAuditReport,
  type VulnerabilityException,
} from './vulnerability-policy.js';

type AuditExecution = Readonly<{ stdout: string; stderr: string; exitCode: number }>;

async function runPnpmAudit(projectRoot: string): Promise<AuditExecution> {
  const pnpmEntry = process.env.npm_execpath;
  if (pnpmEntry === undefined) throw new Error('pnpm_execpath_unavailable');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, 'audit', '--prod', '--json'], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });
}

async function main(): Promise<void> {
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(sourceDirectory, '..', '..', '..');
  const artifactsDirectory = path.join(projectRoot, 'artifacts', 'supply-chain');
  await mkdir(artifactsDirectory, { recursive: true });

  const components = await scanProductionDependencyGraph(path.join(projectRoot, 'apps', 'server'));
  const licenses = evaluateLicenses(components);
  const exceptions = JSON.parse(
    await readFile(
      path.join(projectRoot, 'operations', 'release', 'vulnerability-exceptions.json'),
      'utf8',
    ),
  ) as Partial<VulnerabilityException>[];

  const auditExecution = await runPnpmAudit(projectRoot);
  let audit: unknown;
  try {
    audit = JSON.parse(auditExecution.stdout) as unknown;
  } catch {
    const unavailable = {
      status: 'failed',
      code: 'audit_report_unavailable',
      exitCode: auditExecution.exitCode,
      stderr: auditExecution.stderr.trim().slice(0, 2_000),
    };
    await writeFile(
      path.join(artifactsDirectory, 'supply-chain-policy.json'),
      `${JSON.stringify(unavailable, undefined, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`${JSON.stringify(unavailable)}\n`);
    process.exitCode = 1;
    return;
  }

  const findings = parsePnpmAuditReport(audit);
  const vulnerabilities = evaluateVulnerabilities(findings, exceptions);
  const report = {
    status:
      licenses.status === 'passed' && vulnerabilities.status === 'passed'
        ? ('passed' as const)
        : ('failed' as const),
    dependencyCount: components.length,
    license: licenses,
    vulnerability: {
      ...vulnerabilities,
      findingCount: findings.length,
      findings,
    },
    auditExitCode: auditExecution.exitCode,
  };
  await writeFile(
    path.join(artifactsDirectory, 'supply-chain-policy.json'),
    `${JSON.stringify(report, undefined, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status === 'failed') process.exitCode = 1;
}

await main();
