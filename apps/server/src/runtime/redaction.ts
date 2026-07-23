const sensitiveKey =
  /(?:secret|token|authorization|api.?key|password|prompt|message|content|body|path|root|executable|command.?line)/i;

function redactString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_API_KEY]')
    .replace(/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g, '[REDACTED_PATH]')
    .replace(/(?<![:\w])\/(?:[^/\s"']+\/)*[^/\s"']+/g, '[REDACTED_PATH]');
}

function errorValue(error: Error & { code?: unknown; publicMessage?: unknown }) {
  return {
    name: error.name,
    ...(typeof error.code === 'string' && /^[a-z0-9_]+$/.test(error.code)
      ? { code: error.code }
      : {}),
    ...(typeof error.publicMessage === 'string'
      ? { publicMessage: redactString(error.publicMessage) }
      : {}),
  };
}

function redact(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (value instanceof Error) return errorValue(value);
  if (typeof value !== 'object') return '[REDACTED_UNSERIALIZABLE]';
  if (ancestors.has(value)) return '[REDACTED_CYCLE]';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redact(item, ancestors));
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = sensitiveKey.test(key) ? '[REDACTED]' : redact(item, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function redactForLog(value: unknown): unknown {
  return redact(value, new Set());
}

export function serializeRedacted(value: unknown): string {
  return JSON.stringify(redactForLog(value));
}
