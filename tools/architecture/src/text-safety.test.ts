import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const webSourceRoot = path.join(process.cwd(), 'apps', 'web', 'src');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(absolute);
      return /\.(?:ts|tsx|css)$/.test(entry.name) && !entry.name.includes('.test.')
        ? [absolute]
        : [];
    }),
  );
  return nested.flat().sort();
}

const mojibakeMarkers = ['\uFFFD', '锟斤拷', 'ï¿½', 'â€¦', 'â€”', 'â€˜', 'â€™'];
const internalUiFields = [
  'artifactRef',
  'contentSha256',
  'dataRoot',
  'draftArtifactRef',
  'factType',
  'idempotencyKey',
  'inputSnapshotHash',
  'leaseToken',
  'pageInstanceId',
  'resourceVersion',
  'secretHandles',
] as const;

function attribute(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return opening.attributes.properties.find(
    (item): item is ts.JsxAttribute =>
      ts.isJsxAttribute(item) && item.name.getText(opening.getSourceFile()) === name,
  );
}

function inspectTsx(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  const checkVisible = (node: ts.Node, value: string) => {
    for (const field of internalUiFields) {
      if (new RegExp(`\\b${field}\\b`).test(value)) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        problems.push(
          `${path.relative(process.cwd(), file)}:${position.line + 1} exposes ${field}`,
        );
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) checkVisible(node, node.getText(source));
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      !ts.isJsxAttribute(node.parent) &&
      !ts.isJsxSpreadAttribute(node.parent)
    ) {
      let containsJsx = false;
      const findJsx = (candidate: ts.Node) => {
        if (
          ts.isJsxElement(candidate) ||
          ts.isJsxSelfClosingElement(candidate) ||
          ts.isJsxFragment(candidate)
        ) {
          containsJsx = true;
          return;
        }
        ts.forEachChild(candidate, findJsx);
      };
      ts.forEachChild(node.expression, findJsx);
      if (!containsJsx) checkVisible(node, node.expression.getText(source));
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (opening.tagName.getText(source) === 'button') {
        const click = attribute(opening, 'onClick');
        const type = attribute(opening, 'type')?.initializer;
        const submits = type !== undefined && ts.isStringLiteral(type) && type.text === 'submit';
        if (click === undefined && !submits) {
          const position = source.getLineAndCharacterOfPosition(opening.getStart(source));
          problems.push(
            `${path.relative(process.cwd(), file)}:${position.line + 1} has an unbound button`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

describe('production UI text safety', () => {
  it('[EQ-I18N-01] has no mojibake, internal-field leakage, or unbound operations', async () => {
    const files = await sourceFiles(webSourceRoot);
    const problems: string[] = [];
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      for (const marker of mojibakeMarkers) {
        if (text.includes(marker))
          problems.push(`${path.relative(process.cwd(), file)} has ${marker}`);
      }
      if (
        Array.from(text).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return (
            codePoint <= 8 ||
            codePoint === 11 ||
            codePoint === 12 ||
            (codePoint >= 14 && codePoint <= 31) ||
            (codePoint >= 127 && codePoint <= 159)
          );
        })
      ) {
        problems.push(`${path.relative(process.cwd(), file)} has a control character`);
      }
      if (file.endsWith('.tsx')) problems.push(...inspectTsx(file, text));
    }
    expect(problems).toEqual([]);
  });
});
