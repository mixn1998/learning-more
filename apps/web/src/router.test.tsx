// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes, DeferredRoute, appRouteDefinitions } from './router.js';

const paths = [
  '/',
  '/courses/new',
  '/courses/course_01',
  '/courses/course_01/lessons/lesson_01',
  '/courses/course_01/lessons/lesson_01/record?tab=review',
  '/planning',
  '/history',
  '/profile',
  '/runtime',
] as const;

describe('application router', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it('loads and renders a deferred business route instead of leaving an empty outlet', async () => {
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
      <MemoryRouter initialEntries={['/courses/new']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('学习主题')).toBeInTheDocument();
  });

  it('offers a recoverable screen when a route chunk cannot load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function BrokenRoute(): never {
      throw new Error('route chunk failed');
    }

    render(
      <MemoryRouter>
        <DeferredRoute>
          <BrokenRoute />
        </DeferredRoute>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('当前数据没有被修改');
    expect(screen.getByRole('button', { name: '重新加载页面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回主页' })).toHaveAttribute('href', '/');
  });
});
