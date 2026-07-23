// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Dialog } from './dialog.js';

describe('Dialog', () => {
  it('moves focus inside, traps Tab, closes on Escape, and restores focus', () => {
    const close = vi.fn();
    const view = render(
      <>
        <button type="button">触发器</button>
        <Dialog footer={<button type="button">末尾</button>} onClose={close} open title="确认">
          <button type="button">首项</button>
        </Dialog>
      </>,
    );
    const first = screen.getByRole('button', { name: '首项' });
    const last = screen.getByRole('button', { name: '末尾' });
    expect(first).toHaveFocus();
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('supports a custom visual surface without duplicating focus behavior', () => {
    const close = vi.fn();
    render(
      <Dialog
        chrome="custom"
        initialFocusId="custom-title"
        labelledBy="custom-title"
        onClose={close}
        open
      >
        <h1 id="custom-title" tabIndex={-1}>
          完成报告
        </h1>
        <button type="button">返回</button>
      </Dialog>,
    );

    const title = screen.getByRole('heading', { name: '完成报告' });
    expect(screen.getByRole('dialog', { name: '完成报告' })).toBeInTheDocument();
    expect(title).toHaveFocus();
    fireEvent.keyDown(title, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });
});
