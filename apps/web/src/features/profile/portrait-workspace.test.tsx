// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PortraitWorkspace } from './portrait-workspace.js';

afterEach(cleanup);

const insight = {
  claimId: 'claim_01',
  markdown: '### 复合证据观察\n\n你会根据新证据修正判断。',
  evidence: [],
  synthesis: '当前洞察由有效证据支持。',
};

function renderWorkspace() {
  render(
    <PortraitWorkspace
      title="有边界的学习观察"
      summary="当前画像只覆盖近期证据。"
      updatedLabel="7月14日"
      insights={[insight]}
      onRefresh={vi.fn()}
      onSectionChange={vi.fn()}
    />,
  );
}

describe('PortraitWorkspace settings dialog', () => {
  it('matches the approved compact settings dialog structure', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '画像设置' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'portrait-settings-title');
    expect(dialog.querySelector('.settings-body')).toBeInTheDocument();
    expect(dialog.querySelector('.setting-row')).toBeInTheDocument();
    expect(dialog.querySelector('.setting-group')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.setting-switch')).toHaveLength(2);
    expect(dialog.querySelector('.portrait-setting-card')).not.toBeInTheDocument();
    expect(screen.getByText('控制画像参考学习记录的历史跨度')).toBeVisible();
    expect(screen.getByRole('button', { name: '关闭画像设置' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: '证据时间范围' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: '课节与课程 Review' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '学习对话中的有效行为证据' })).toBeChecked();
    expect(screen.getByRole('button', { name: '取消' })).toBeVisible();
    expect(screen.getByRole('button', { name: '保存设置' })).toBeVisible();
  });

  it('persists saved settings and discards changes cancelled afterward', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '画像设置' }));
    fireEvent.change(screen.getByRole('combobox', { name: '证据时间范围' }), {
      target: { value: '90d' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '课节与课程 Review' }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    fireEvent.click(screen.getByRole('button', { name: '画像设置' }));
    expect(screen.getByRole('combobox', { name: '证据时间范围' })).toHaveValue('90d');
    expect(screen.getByRole('checkbox', { name: '课节与课程 Review' })).not.toBeChecked();

    fireEvent.change(screen.getByRole('combobox', { name: '证据时间范围' }), {
      target: { value: 'year' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '画像设置' }));

    expect(screen.getByRole('combobox', { name: '证据时间范围' })).toHaveValue('90d');
  });
});
