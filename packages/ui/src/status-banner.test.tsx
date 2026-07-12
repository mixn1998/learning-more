// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusBanner } from './status-banner.js';

describe('StatusBanner', () => {
  it('announces degraded data as an alert', () => {
    render(<StatusBanner status="degraded" />);

    expect(screen.getByRole('alert')).toHaveTextContent('数据需要修复');
  });

  it('renders a calm ready status without alert semantics', () => {
    render(<StatusBanner status="ready" />);

    expect(screen.getByText('运行正常')).toHaveAttribute('role', 'status');
  });
});
