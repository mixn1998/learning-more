// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReviewDialog } from './review-dialog.js';

afterEach(cleanup);

describe('ReviewDialog', () => {
  it('renders final Review Markdown as headings, lists, emphasis, and quotes', () => {
    render(
      <ReviewDialog
        markdown={
          '## What changed\n\n**Evidence:**\n\n- revised a claim\n- tested an example\n\n> Adjacent exploration did not complete the lesson core.'
        }
        open
        title="Semantic Review"
      />,
    );

    expect(screen.getByRole('heading', { name: 'What changed' })).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Evidence:').tagName).toBe('STRONG');
    expect(document.querySelector('.review-markdown blockquote')).toHaveTextContent(
      'Adjacent exploration did not complete the lesson core.',
    );
  });

  it('uses the shared dialog keyboard contract while preserving the two approved actions', () => {
    const close = vi.fn();
    render(
      <ReviewDialog
        courseTitle="测试课程"
        markdown="正文"
        onBackToOutline={vi.fn()}
        onClose={close}
        onViewRecord={vi.fn()}
        open
        title="测试课节"
      />,
    );

    const dialog = screen.getByRole('dialog', { name: '测试课节' });
    expect(screen.getByRole('heading', { name: '测试课节' })).toHaveFocus();
    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      '返回课程大纲',
      '查看课节记录',
    ]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('projects a structured final Review and does not duplicate the global runtime header', () => {
    render(
      <ReviewDialog
        document={{
          schemaVersion: 1,
          kind: 'lesson-final',
          title: '第一讲总结：判断何时发生反转',
          knowledgeMap: { title: '决策线索', markdown: '情境 → 阈值 → 选择' },
          methodologyInsight: '先找会改变结果的阈值，再比较跨过阈值前后的选择。',
          coreInsight:
            '**判断主线：** 情境 → 阈值 → 选择\n\n1. 先识别当前情境。\n2. 再检查是否跨过阈值。\n\n> 答案取决于是否跨过会改变结果的边界。',
          performance: [
            { title: '你做得很好的地方', markdown: '主动检查了规则前提。' },
            { title: '接下来的判断', markdown: '在新情境中独立定位阈值。' },
          ],
        }}
        markdown="legacy"
        open
        title="关键阈值"
      />,
    );

    expect(screen.getByRole('heading', { name: '知识图谱' })).toBeVisible();
    expect(screen.getByRole('list', { name: '本课知识关系主链' })).toBeVisible();
    expect(
      screen.getByRole('list', { name: '本课知识关系主链' }).querySelectorAll('li'),
    ).toHaveLength(3);
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings.indexOf('本课方法论启示')).toBeGreaterThan(headings.indexOf('知识图谱'));
    expect(headings.indexOf('本课方法论启示')).toBeLessThan(headings.indexOf('核心思想'));
    expect(screen.getByText('先找会改变结果的阈值，再比较跨过阈值前后的选择。')).toBeVisible();
    expect(screen.getByText('判断主线：').tagName).toBe('STRONG');
    expect(
      screen.getByRole('heading', { name: '核心思想' }).closest('section')?.querySelectorAll('li'),
    ).toHaveLength(2);
    expect(document.querySelector('.lesson-final-review-document blockquote')).toHaveTextContent(
      '答案取决于是否跨过会改变结果的边界。',
    );
    expect(screen.getByText('主动检查了规则前提。')).toBeVisible();
    expect(screen.queryByText('AI 接口 · Codex')).not.toBeInTheDocument();
  });

  it('does not fabricate a methodology insight from core insight when the field is absent', () => {
    render(
      <ReviewDialog
        document={{
          schemaVersion: 1,
          kind: 'lesson-final',
          title: '历史课时 Review',
          knowledgeMap: { title: '知识图谱', markdown: '前提 → 判断' },
          coreInsight: '核心方法是先确认判断条件，再决定结论能否迁移。',
          performance: [{ title: '已经形成', markdown: '完成了本课互动。' }],
        }}
        markdown="legacy"
        open
        title="历史课节"
      />,
    );

    expect(screen.queryByRole('heading', { name: '本课方法论启示' })).not.toBeInTheDocument();
    expect(screen.getByText('核心方法是先确认判断条件，再决定结论能否迁移。')).toBeVisible();
  });

  it('projects a legacy methodology insight block into the shared module', () => {
    render(
      <ReviewDialog
        document={{
          schemaVersion: 1,
          kind: 'lesson-final',
          title: '旧课时 Review',
          knowledgeMap: { title: '知识图谱', markdown: '前提 → 判断' },
          coreInsight: '旧版核心思想。',
          performance: [{ title: '已经形成', markdown: '完成了本课互动。' }],
          additionalSections: [
            {
              title: '可以带走的一句话',
              markdown: '先检查会改变结论的条件，再决定原来的判断能否迁移。',
            },
          ],
        }}
        markdown="legacy"
        open
        title="旧课节"
      />,
    );

    expect(screen.getByRole('heading', { name: '本课方法论启示' })).toBeVisible();
    expect(screen.getByText('先检查会改变结论的条件，再决定原来的判断能否迁移。')).toBeVisible();
  });

  it('projects a methodology insight heading from legacy Review Markdown', () => {
    render(
      <ReviewDialog
        document={{
          schemaVersion: 1,
          kind: 'lesson-final',
          title: '旧课时 Markdown Review',
          knowledgeMap: { title: '知识图谱', markdown: '前提 → 判断' },
          coreInsight: '旧版核心思想。',
          performance: [{ title: '已经形成', markdown: '完成了本课互动。' }],
        }}
        markdown={
          '# 旧课时 Markdown Review\n\n## 可以带走的一句话\n\n先检查条件，再决定判断是否能迁移。\n\n## 核心思想\n\n旧版核心思想。'
        }
        open
        title="旧课节 Markdown"
      />,
    );

    expect(screen.getByRole('heading', { name: '本课方法论启示' })).toBeVisible();
    expect(screen.getByText('先检查条件，再决定判断是否能迁移。')).toBeVisible();
  });
});
