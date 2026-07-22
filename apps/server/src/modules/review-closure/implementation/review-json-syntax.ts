import { jsonrepair } from 'jsonrepair';

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
  try {
    return JSON.parse(source);
  } catch {
    try {
      return mergePrematurelyClosedObject(JSON.parse(jsonrepair(source)));
    } catch {
      return undefined;
    }
  }
}
