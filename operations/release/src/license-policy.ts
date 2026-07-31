import type { PackageComponent } from './sbom.js';

export type LicenseIssue = Readonly<{
  code: 'unknown_license' | 'prohibited_license';
  package: string;
  version: string;
  license?: string;
}>;

export type LicensePolicy = Readonly<{
  allowed: ReadonlySet<string>;
  prohibited: ReadonlySet<string>;
  internalPackagePrefixes: readonly string[];
}>;

export const DEFAULT_LICENSE_POLICY: LicensePolicy = {
  allowed: new Set([
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MPL-2.0',
    'Python-2.0',
    'Unlicense',
  ]),
  prohibited: new Set([
    'AGPL-1.0-only',
    'AGPL-1.0-or-later',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'BUSL-1.1',
    'Commons-Clause',
    'GPL-1.0-only',
    'GPL-1.0-or-later',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'SSPL-1.0',
  ]),
  internalPackagePrefixes: ['@learning-more/'],
};

type LicenseDecision = 'allowed' | 'prohibited' | 'unknown';

function stripOuterParentheses(expression: string): string {
  let output = expression.trim();
  while (output.startsWith('(') && output.endsWith(')')) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let index = 0; index < output.length; index += 1) {
      const character = output[index];
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (depth === 0 && index < output.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression) break;
    output = output.slice(1, -1).trim();
  }
  return output;
}

function splitTopLevel(expression: string, operator: ' AND ' | ' OR '): string[] {
  const output: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= expression.length - operator.length; index += 1) {
    const character = expression[index];
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && expression.slice(index, index + operator.length) === operator) {
      output.push(expression.slice(start, index));
      start = index + operator.length;
      index = start - 1;
    }
  }
  output.push(expression.slice(start));
  return output;
}

function decideExpression(expression: string, policy: LicensePolicy): LicenseDecision {
  const normalized = stripOuterParentheses(expression);
  const alternatives = splitTopLevel(normalized, ' OR ');
  if (alternatives.length > 1) {
    const decisions = alternatives.map((part) => decideExpression(part, policy));
    if (decisions.includes('allowed')) return 'allowed';
    return decisions.includes('prohibited') ? 'prohibited' : 'unknown';
  }

  const conjunctions = splitTopLevel(normalized, ' AND ');
  if (conjunctions.length > 1) {
    const decisions = conjunctions.map((part) => decideExpression(part, policy));
    if (decisions.includes('prohibited')) return 'prohibited';
    return decisions.every((decision) => decision === 'allowed') ? 'allowed' : 'unknown';
  }

  if (policy.allowed.has(normalized)) return 'allowed';
  if (policy.prohibited.has(normalized)) return 'prohibited';
  return 'unknown';
}

export function evaluateLicenses(
  components: readonly PackageComponent[],
  policy: LicensePolicy = DEFAULT_LICENSE_POLICY,
): Readonly<{ status: 'passed' | 'failed'; issues: readonly LicenseIssue[] }> {
  const issues: LicenseIssue[] = [];
  for (const component of components) {
    if (policy.internalPackagePrefixes.some((prefix) => component.name.startsWith(prefix))) {
      continue;
    }
    if (component.license === undefined || component.license.trim() === '') {
      issues.push({
        code: 'unknown_license',
        package: component.name,
        version: component.version,
      });
      continue;
    }
    const decision = decideExpression(component.license, policy);
    if (decision !== 'allowed') {
      issues.push({
        code: decision === 'prohibited' ? 'prohibited_license' : 'unknown_license',
        package: component.name,
        version: component.version,
        license: component.license,
      });
    }
  }
  return { status: issues.length === 0 ? 'passed' : 'failed', issues };
}
