import { jsonrepair } from 'jsonrepair';

type MathDelimiter = '$' | '$$' | '\\(' | '\\[';

function isAsciiLetter(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z]$/u.test(value);
}

function normalizeMarkdownMathEscapes(source: string): string {
  let normalized = '';
  let inString = false;
  let mathDelimiter: MathDelimiter | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (!inString) {
      normalized += character;
      if (character === '"') inString = true;
      continue;
    }
    if (character === '"') {
      normalized += character;
      inString = false;
      mathDelimiter = undefined;
      continue;
    }
    if (character === '$') {
      const delimiter: MathDelimiter = source[index + 1] === '$' ? '$$' : '$';
      normalized += delimiter;
      if (delimiter === '$$') index += 1;
      mathDelimiter = mathDelimiter === delimiter ? undefined : (mathDelimiter ?? delimiter);
      continue;
    }
    if (character !== '\\') {
      normalized += character;
      continue;
    }

    const next = source[index + 1];
    if (next === undefined) {
      normalized += '\\\\';
      continue;
    }
    if (next === '\\' || next === '"' || next === '/') {
      normalized += `\\${next}`;
      index += 1;
      continue;
    }
    if (next === '[' || next === '(') {
      normalized += `\\\\${next}`;
      mathDelimiter = next === '[' ? '\\[' : '\\(';
      index += 1;
      continue;
    }
    if (next === ']' || next === ')') {
      normalized += `\\\\${next}`;
      const closingDelimiter: MathDelimiter = next === ']' ? '\\[' : '\\(';
      if (mathDelimiter === closingDelimiter) mathDelimiter = undefined;
      index += 1;
      continue;
    }

    const isJsonControlEscape = /^[bfnrt]$/u.test(next);
    const isUnicodeEscape =
      next === 'u' && /^[0-9a-fA-F]{4}$/u.test(source.slice(index + 2, index + 6));
    const isLikelyTexControlWord =
      mathDelimiter !== undefined && isJsonControlEscape && isAsciiLetter(source[index + 2]);
    if ((!isJsonControlEscape && !isUnicodeEscape) || isLikelyTexControlWord) {
      normalized += `\\\\${next}`;
      index += 1;
      continue;
    }

    normalized += `\\${next}`;
    index += 1;
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePrematurelyClosedObject(value: unknown): unknown {
  if (!Array.isArray(value) || value.length < 4 || !isRecord(value[0])) return value;
  if ((value.length - 1) % 3 !== 0) return value;

  const merged: Record<string, unknown> = { ...value[0] };
  for (let index = 1; index < value.length; index += 3) {
    const key = value[index];
    const separator = value[index + 1];
    if (typeof key !== 'string' || separator !== ':' || key in merged) return value;
    merged[key] = value[index + 2];
  }
  return merged;
}

export function parseJsonWithSyntaxRepair(source: string): unknown | undefined {
  const normalized = normalizeMarkdownMathEscapes(source);
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return mergePrematurelyClosedObject(JSON.parse(jsonrepair(normalized)));
    } catch {
      return undefined;
    }
  }
}
