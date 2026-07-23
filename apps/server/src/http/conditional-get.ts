import type { FastifyReply, FastifyRequest } from 'fastify';

function quoteEtag(etag: string): string {
  const normalized = etag.trim().replace(/^W\//, '');
  return normalized.startsWith('"') && normalized.endsWith('"')
    ? normalized
    : `"${normalized.replaceAll('"', '')}"`;
}

function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const values = Array.isArray(header) ? header : header.split(',');
  const expected = quoteEtag(etag);
  return values.some((value) => {
    const candidate = value.trim();
    return candidate === '*' || quoteEtag(candidate) === expected;
  });
}

export function sendConditionalJson<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  input: Readonly<{
    etag: string;
    value: T;
    projectionStatus?: string;
  }>,
) {
  const response = reply
    .header('etag', quoteEtag(input.etag))
    .header('cache-control', 'private, no-cache');
  if (input.projectionStatus !== undefined) {
    response.header('x-projection-status', input.projectionStatus);
  }
  if (matchesEtag(request.headers['if-none-match'], input.etag)) {
    return response.code(304).send();
  }
  return response.code(200).send(input.value);
}
