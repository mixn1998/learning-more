import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toJSONSchema } from 'zod';

import {
  AppendOutlineSessionMessageBodySchema,
  ApplicationProblemSchema,
  ConfirmationResponseSchema,
  ConfirmOutlineCandidateBodySchema,
  CreateOutlineSessionBodySchema,
  GenerationAcceptedResponseSchema,
  OutlineMessageResponseSchema,
  OutlineRevisionResponseSchema,
  OutlineSessionResponseSchema,
  OutlineSessionViewResponseSchema,
  RequestCandidateGenerationBodySchema,
  ReviseCourseOutlineBodySchema,
} from '../dist/index.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(directory, '../openapi/course-authoring.openapi.json');

function embeddedSchema(schema) {
  const jsonSchema = toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
  });
  delete jsonSchema.$schema;
  return jsonSchema;
}

function jsonBody(schemaName) {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

function response(description, schemaName) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } },
  };
}

function errorResponses() {
  return Object.fromEntries(
    ['400', '404', '409', '412', '428', '500'].map((status) => [
      status,
      response('Application problem', 'ApplicationProblem'),
    ]),
  );
}

function document() {
  const sessionParameter = {
    name: 'sessionId',
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1 },
  };
  const courseParameter = {
    name: 'courseId',
    in: 'path',
    required: true,
    schema: { type: 'string', minLength: 1 },
  };
  return {
    openapi: '3.1.0',
    info: { title: 'Learning MORE CourseAuthoring API', version: '1' },
    paths: {
      '/api/v1/outline-sessions': {
        post: {
          operationId: 'createOutlineSession',
          requestBody: jsonBody('CreateOutlineSessionBody'),
          responses: {
            201: response('OutlineSession created', 'OutlineSessionResponse'),
            ...errorResponses(),
          },
        },
      },
      '/api/v1/outline-sessions/{sessionId}': {
        get: {
          operationId: 'getOutlineSession',
          parameters: [sessionParameter],
          responses: {
            200: response('OutlineSession view', 'OutlineSessionViewResponse'),
            ...errorResponses(),
          },
        },
      },
      '/api/v1/outline-sessions/{sessionId}/messages': {
        post: {
          operationId: 'appendOutlineSessionMessage',
          parameters: [sessionParameter],
          requestBody: jsonBody('AppendOutlineSessionMessageBody'),
          responses: {
            200: response('Message accepted', 'OutlineMessageResponse'),
            ...errorResponses(),
          },
        },
      },
      '/api/v1/outline-sessions/{sessionId}/candidate-generations': {
        post: {
          operationId: 'requestCandidateGeneration',
          parameters: [sessionParameter],
          requestBody: jsonBody('RequestCandidateGenerationBody'),
          responses: {
            202: response('Generation accepted', 'GenerationAcceptedResponse'),
            ...errorResponses(),
          },
        },
      },
      '/api/v1/outline-sessions/{sessionId}/confirmations': {
        post: {
          operationId: 'confirmOutlineCandidate',
          parameters: [sessionParameter],
          requestBody: jsonBody('ConfirmOutlineCandidateBody'),
          responses: {
            201: response('Course created', 'ConfirmationResponse'),
            ...errorResponses(),
          },
        },
      },
      '/api/v1/courses/{courseId}/outline-revisions': {
        post: {
          operationId: 'reviseCourseOutline',
          parameters: [courseParameter],
          requestBody: jsonBody('ReviseCourseOutlineBody'),
          responses: {
            201: response('Outline revision created', 'OutlineRevisionResponse'),
            ...errorResponses(),
          },
        },
      },
    },
    components: {
      schemas: {
        CreateOutlineSessionBody: embeddedSchema(CreateOutlineSessionBodySchema),
        AppendOutlineSessionMessageBody: embeddedSchema(AppendOutlineSessionMessageBodySchema),
        RequestCandidateGenerationBody: embeddedSchema(RequestCandidateGenerationBodySchema),
        ConfirmOutlineCandidateBody: embeddedSchema(ConfirmOutlineCandidateBodySchema),
        ReviseCourseOutlineBody: embeddedSchema(ReviseCourseOutlineBodySchema),
        OutlineSessionResponse: embeddedSchema(OutlineSessionResponseSchema),
        OutlineSessionViewResponse: embeddedSchema(OutlineSessionViewResponseSchema),
        OutlineMessageResponse: embeddedSchema(OutlineMessageResponseSchema),
        GenerationAcceptedResponse: embeddedSchema(GenerationAcceptedResponseSchema),
        ConfirmationResponse: embeddedSchema(ConfirmationResponseSchema),
        OutlineRevisionResponse: embeddedSchema(OutlineRevisionResponseSchema),
        ApplicationProblem: embeddedSchema(ApplicationProblemSchema),
      },
    },
  };
}

const expected = `${JSON.stringify(document(), null, 2)}\n`;
if (process.argv.includes('--write')) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
} else {
  let actual;
  try {
    actual = await readFile(outputPath, 'utf8');
  } catch {
    actual = '';
  }
  if (actual !== expected) {
    console.error('CourseAuthoring OpenAPI is stale. Run pnpm schema:generate.');
    process.exitCode = 1;
  } else {
    console.log('CourseAuthoring OpenAPI matches the shared Zod schemas.');
  }
}
