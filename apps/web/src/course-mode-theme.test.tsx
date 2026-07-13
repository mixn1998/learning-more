// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CourseModeIdentity } from './course-mode-identity.js';

afterEach(cleanup);

describe('course mode identity', () => {
  it('[EQ-PLAY-09] carries one registry identity through authoring, learning, Review, and history without replacing status', () => {
    const { rerender } = render(
      <CourseModeIdentity mode="case_study" context="authoring" status="warning" />,
    );
    const identity = screen.getByText('案例').closest('section')!;
    expect(identity).toHaveAttribute('data-course-mode', 'case_study');
    expect(identity).toHaveAttribute('data-semantic-status', 'warning');
    const accent = identity.style.borderInlineStart;

    for (const context of ['learning', 'review', 'history'] as const) {
      rerender(<CourseModeIdentity mode="case_study" context={context} status="readonly" />);
      expect(screen.getByText('案例').closest('section')).toHaveStyle({
        borderInlineStart: accent,
      });
      expect(screen.getByText('案例').closest('section')).toHaveAttribute(
        'data-semantic-status',
        'readonly',
      );
    }
  });
});
