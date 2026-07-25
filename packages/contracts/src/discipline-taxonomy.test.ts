import { describe, expect, it } from 'vitest';

import { projectDisciplineLabel } from './discipline-taxonomy.js';

describe('discipline taxonomy projection', () => {
  it('uses concise labels for specific social-science disciplines', () => {
    expect(projectDisciplineLabel({ disciplineTag: '政治学' })).toBe('政治');
    expect(projectDisciplineLabel({ disciplineTag: '经济学' })).toBe('经济');
    expect(projectDisciplineLabel({ disciplineTag: '社会学' })).toBe('社会');
    expect(projectDisciplineLabel({ disciplineTag: '心理学' })).toBe('心理');
    expect(projectDisciplineLabel({ disciplineTag: '历史学' })).toBe('历史');
    expect(projectDisciplineLabel({ disciplineTag: '法学' })).toBe('法律');
  });

  it('refines existing social-science courses from their title and topic evidence', () => {
    expect(
      projectDisciplineLabel({
        disciplineTag: '社会科学',
        title: '问题驱动的经济分析',
        topicTags: ['经济分析方法', '宏观经济波动'],
      }),
    ).toBe('经济');
    expect(
      projectDisciplineLabel({
        disciplineTag: '社会科学',
        title: '周游列国：政治制度如何形成',
        topicTags: ['比较政治学', '国家能力', '历史制度主义', '战争财政'],
      }),
    ).toBe('政治');
    expect(
      projectDisciplineLabel({
        disciplineTag: '社会科学',
        title: '强耦合世界中的解释',
        topicTags: [
          '历史学解释',
          '社会学解释',
          '制度形成',
          '社会关系',
          '群体差异',
          '组织执行',
          '社会再生产',
        ],
      }),
    ).toBe('社会');
  });

  it('keeps the umbrella category when evidence cannot support a stable refinement', () => {
    expect(
      projectDisciplineLabel({
        disciplineTag: '社会科学',
        title: '跨学科问题研究',
        topicTags: ['复杂系统'],
      }),
    ).toBe('社会科学');
  });
});
