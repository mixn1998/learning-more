// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button, ButtonLink } from './button.js';

describe('Button primitives', () => {
  it('keeps the approved baseline classes and disables a busy action', () => {
    render(
      <Button busy variant="primary">
        保存
      </Button>,
    );

    expect(screen.getByRole('button', { name: '保存' })).toHaveClass(
      'lm-button',
      'lm-btn',
      'primary',
    );
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('renders navigation with the same visual primitive without button semantics', () => {
    render(<ButtonLink href="/index">返回索引</ButtonLink>);

    expect(screen.getByRole('link', { name: '返回索引' })).toHaveAttribute('href', '/index');
    expect(screen.getByRole('link', { name: '返回索引' })).toHaveClass('lm-button', 'lm-btn');
  });
});
