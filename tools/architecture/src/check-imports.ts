import ts from 'typescript';

import { IMPORT_RULES, type ImportRule } from './rules.js';

export type ImportIssue = Readonly<{
  code: 'FORBIDDEN_IMPORT';
  rule: ImportRule;
  source: string;
  target: string;
}>;

function normalize(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function serverModule(filePath: string): string | undefined {
  return /^apps\/server\/src\/modules\/([^/]+)\//.exec(filePath)?.[1];
}

function isApprovedWebFrameworkImport(target: string): boolean {
  return (
    target === 'react' ||
    target.startsWith('react/') ||
    target === 'react-dom' ||
    target.startsWith('react-dom/') ||
    target === 'react-router-dom' ||
    target === 'react-markdown' ||
    target === 'rehype-sanitize' ||
    target === 'vite' ||
    target === '@vitejs/plugin-react'
  );
}

export function checkImport(sourcePath: string, targetPath: string): ImportIssue | undefined {
  const source = normalize(sourcePath);
  const target = normalize(targetPath);

  if (source.startsWith('apps/web/')) {
    const allowed =
      target.startsWith('apps/web/') ||
      target.startsWith('packages/contracts/') ||
      target.startsWith('packages/ui/') ||
      isApprovedWebFrameworkImport(target);
    if (!allowed) {
      return {
        code: 'FORBIDDEN_IMPORT',
        rule: IMPORT_RULES.webAllowedDependenciesOnly,
        source,
        target,
      };
    }
  }

  if (source.startsWith('packages/contracts/')) {
    const platformDependent =
      target.startsWith('apps/') ||
      target.startsWith('node:') ||
      target === 'react' ||
      target.startsWith('react/');
    if (platformDependent) {
      return {
        code: 'FORBIDDEN_IMPORT',
        rule: IMPORT_RULES.contractsPlatformIndependent,
        source,
        target,
      };
    }
  }

  const sourceModule = serverModule(source);
  const targetModule = serverModule(target);
  if (
    sourceModule !== undefined &&
    targetModule !== undefined &&
    sourceModule !== targetModule &&
    !target.endsWith('/interface.ts')
  ) {
    return {
      code: 'FORBIDDEN_IMPORT',
      rule: IMPORT_RULES.modulePublicInterfaceOnly,
      source,
      target,
    };
  }

  return undefined;
}

export function collectModuleSpecifiers(sourceText: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const firstArgument = node.arguments[0];
      if (
        node.arguments.length === 1 &&
        firstArgument !== undefined &&
        ts.isStringLiteral(firstArgument)
      ) {
        specifiers.push(firstArgument.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}
