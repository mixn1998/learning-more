import { describe, expect, it } from 'vitest';

import { redactForLog, serializeRedacted } from './redaction.js';

describe('runtime redaction', () => {
  it('removes key-based and pattern-based secrets, prompts, bodies, and absolute paths', () => {
    const error = Object.assign(
      new Error('failed with sk-secret-1234567890 at D:\\private\\data'),
      {
        code: 'provider_failed',
        apiKey: 'sanitized-secret-ec4b8c85ad80',
        cause: { authorization: 'Bearer LM_BEARER_SENTINEL' },
      },
    );
    const serialized = serializeRedacted({
      error,
      prompt: 'LM_PROMPT_SENTINEL explain everything',
      message: 'LM_MESSAGE_SENTINEL private learning text',
      dataRoot: 'D:\\workspace\\private-data',
      nested: {
        token: 'LM_TOKEN_SENTINEL',
        note: 'Authorization: Bearer LM_INLINE_BEARER and /home/example-user/data.json',
      },
      safeCount: 4,
      safeCode: 'generation_failed',
    });
    for (const sentinel of [
      'sk-secret-1234567890',
      'sanitized-secret-ec4b8c85ad80',
      'LM_BEARER_SENTINEL',
      'LM_PROMPT_SENTINEL',
      'LM_MESSAGE_SENTINEL',
      'LM_TOKEN_SENTINEL',
      'D:\\private',
      'D:\\workspace',
      '/home/example-user',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    expect(JSON.parse(serialized)).toMatchObject({ safeCount: 4, safeCode: 'generation_failed' });
  });

  it('reduces Error values to public name and declared code', () => {
    const error = Object.assign(new Error('private message'), { code: 'storage_corrupted' });
    expect(redactForLog(error)).toEqual({ name: 'Error', code: 'storage_corrupted' });
  });
});
