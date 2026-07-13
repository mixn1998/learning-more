// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes, appRouteDefinitions } from './router.js';

const paths = [
  '/',
  '/courses/new',
  '/courses/course_01',
  '/courses/course_01/lessons/lesson_01',
  '/planning',
  '/history',
  '/profile',
  '/runtime',
] as const;

describe('application router', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(paths)('deep-links %s through the shared application shell', (path) => {
    const matches = matchRoutes(appRouteDefinitions, path);
    expect(matches?.[0]?.route.id).toBe('app-shell');
    expect(matches?.at(-1)?.route.id).toBeTruthy();
  });

  it('offers a route back home for unknown URLs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 'ready',
            instanceId: 'instance_01',
            buildId: 'development',
            protocolVersion: '1',
            storeStatus: 'ready',
            projectionStatus: 'ready',
            providerStatus: 'ready',
          }),
          { status: 200 },
        ),
      ),
    );
    render(
      <MemoryRouter initialEntries={['/not-a-route']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/');
  });
});
