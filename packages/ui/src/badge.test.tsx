// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge, ModeBadge, ModeIcon } from './badge.js';

describe('Badge primitives', () => {
  it('keeps semantic status separate from course-mode identity', () => {
    render(
      <>
        <Badge tone="success">已完成</Badge>
        <ModeBadge>阅读研讨</ModeBadge>
      </>,
    );

    expect(screen.getByText('已完成')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('阅读研讨')).toHaveAttribute('data-identity', 'course-mode');
    expect(screen.getByText('阅读研讨')).not.toHaveAttribute('data-tone');
  });

  it('hides a decorative mode icon from assistive technology', () => {
    const { container } = render(<ModeIcon>¶</ModeIcon>);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
