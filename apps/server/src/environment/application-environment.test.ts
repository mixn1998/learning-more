import { describe, expect, it } from 'vitest';

import type { SecretStore } from '../runtime/secret-store.js';
import { createApplicationEnvironment } from './application-environment.js';

const secretStore = {} as SecretStore;

describe('ApplicationEnvironment', () => {
  it('preserves the local data root and exposes a stable principal through request access', async () => {
    const environment = createApplicationEnvironment({
      mode: 'local',
      dataRoot: 'D:\\data\\learning-more',
      allowedOrigin: 'http://127.0.0.1:5173',
      csrfToken: 'csrf',
      secretStore,
    });

    expect(environment).toMatchObject({
      mode: 'local',
      principal: {
        subjectId: 'local-user',
        dataScopeId: 'local',
        roles: ['owner'],
      },
      dataScope: {
        id: 'local',
        dataRoot: 'D:\\data\\learning-more',
      },
      secretStore,
    });
    await expect(
      environment.requestAccess.authorize({
        method: 'POST',
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        csrfToken: 'csrf',
      }),
    ).resolves.toEqual({
      authorized: true,
      principal: environment.principal,
    });
  });

  it('keeps local host, origin, and CSRF checks inside the request-access adapter', async () => {
    const environment = createApplicationEnvironment({
      mode: 'local',
      dataRoot: 'D:\\data\\learning-more',
      allowedOrigin: 'http://127.0.0.1:5173',
      csrfToken: 'csrf',
      secretStore,
    });

    for (const request of [
      {
        method: 'GET',
        host: 'learning.example.com',
        origin: 'http://127.0.0.1:5173',
      },
      {
        method: 'GET',
        host: '127.0.0.1:43120',
        origin: 'https://foreign.example.com',
      },
      {
        method: 'POST',
        host: '127.0.0.1:43120',
        origin: 'http://127.0.0.1:5173',
        csrfToken: 'wrong',
      },
    ]) {
      await expect(environment.requestAccess.authorize(request)).resolves.toMatchObject({
        authorized: false,
        status: 403,
        code: 'local_request_forbidden',
      });
    }
  });

  it('reserves platform mode without starting an incomplete deployment adapter', () => {
    expect(() =>
      createApplicationEnvironment({
        mode: 'platform',
        dataRoot: 'D:\\data\\learning-more',
        allowedOrigin: 'https://platform.example.com',
        csrfToken: 'unused',
        secretStore,
      }),
    ).toThrow('deployment_mode_not_supported:platform');
  });
});
