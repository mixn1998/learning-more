// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tabId, tabPanelId, Tabs } from './tabs.js';

const options = [
  { id: 'one', label: '第一项' },
  { id: 'two', label: '第二项' },
  { id: 'three', label: '第三项' },
] as const;

afterEach(cleanup);

describe('Tabs', () => {
  it('associates tabs with panels and exposes only the active tab in the tab order', () => {
    render(
      <Tabs label="内容" active="two" idPrefix="content" options={options} onChange={vi.fn()} />,
    );

    const first = screen.getByRole('tab', { name: '第一项' });
    const second = screen.getByRole('tab', { name: '第二项' });
    expect(first).toHaveAttribute('id', tabId('content', 'one'));
    expect(first).toHaveAttribute('aria-controls', tabPanelId('content', 'one'));
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('tabindex', '0');
  });

  it('wraps arrow navigation and supports Home and End with automatic activation', () => {
    const change = vi.fn();
    render(
      <Tabs label="内容" active="one" idPrefix="content" options={options} onChange={change} />,
    );
    const first = screen.getByRole('tab', { name: '第一项' });
    const last = screen.getByRole('tab', { name: '第三项' });

    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(change).toHaveBeenLastCalledWith('three');
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Home' });
    expect(change).toHaveBeenLastCalledWith('one');
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'End' });
    expect(change).toHaveBeenLastCalledWith('three');
    expect(last).toHaveFocus();
  });
});
