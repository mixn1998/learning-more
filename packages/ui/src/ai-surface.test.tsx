// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiSurface } from './ai-surface.js';

describe('AiSurface', () => {
  it('marks a validated structured AI layout without parsing its elements', () => {
    const { container } = render(
      <AiSurface>
        <section>
          <h2>结构化结果</h2>
          <p>已由领域 Schema 校验</p>
        </section>
      </AiSurface>,
    );
    expect(container.querySelector('[data-ai-surface="true"]')).toBeVisible();
    expect(screen.getByRole('heading', { name: '结构化结果' })).toBeVisible();
  });
});
