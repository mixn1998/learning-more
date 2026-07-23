import { describe, expect, it } from 'vitest';

import { projectLessonReviewDocument } from './review-document-presentation.js';

describe('lesson Review presentation projection', () => {
  it('reduces a verbose knowledge map to its relation chain', () => {
    const projection = projectLessonReviewDocument({
      knowledgeMap: {
        title: '本课知识地图',
        markdown:
          '本课建立的主链条是：目标体验 → 核心循环 → 决策节点 → 因果反馈。\n\n- 目标体验包含大量解释。\n- 核心循环还包含更多解释。',
      },
      coreInsight: '本课要解决条件变化时如何修正判断。\n\n核心方法是比较阈值与结果边界。',
      performance: [
        { title: '你做得好的地方', markdown: '主动检查了规则前提。' },
        { title: '接下来的判断', markdown: '- 在新情境中独立定位阈值。' },
      ],
    });

    expect(projection.knowledgeMap.markdown).toBe('目标体验 → 核心循环 → 决策节点 → 因果反馈');
    expect(projection.knowledgeMapNodes).toEqual(['目标体验', '核心循环', '决策节点', '因果反馈']);
  });

  it('converts legacy tree-form knowledge maps into the same relation-chain projection', () => {
    const projection = projectLessonReviewDocument({
      knowledgeMap: {
        title: '本课知识地图',
        markdown:
          '├─ 核心判断 ├─ 机会成本与局面依赖 ├─ 关键阈值 ├─ 信息条件与风险—回报 └─ 将复杂分析变得可执行',
      },
      coreInsight: '本课要解决如何判断选择是否真正有意义。',
      performance: [
        { title: '你做得好的地方', markdown: '主动检查了规则前提。' },
        { title: '接下来的判断', markdown: '在新情境中独立验证。' },
      ],
    });

    expect(projection.knowledgeMap.markdown).toBe(
      '核心判断 → 机会成本与局面依赖 → 关键阈值 → 信息条件与风险—回报 → 将复杂分析变得可执行',
    );
    expect(projection.knowledgeMapNodes).toEqual([
      '核心判断',
      '机会成本与局面依赖',
      '关键阈值',
      '信息条件与风险—回报',
      '将复杂分析变得可执行',
    ]);
  });

  it('coalesces many detailed performance blocks into two concise display blocks', () => {
    const projection = projectLessonReviewDocument({
      knowledgeMap: { title: '线索', markdown: '条件 → 判断 → 行动' },
      coreInsight: '本课要解决如何把抽象目标落到行动。',
      performance: [
        { title: '从抽象体验落到行动', markdown: '把目标拆成了可观察的行动和结果。第二句细节。' },
        { title: '检查资源依赖', markdown: '识别了生命、能量和回合约束。更多细节。' },
        { title: '比较决策信息', markdown: '开始比较成功机会与失败承受能力。' },
        { title: '尚待验证', markdown: '- 独立计算复杂场景中的阈值。\n- 检查新案例。' },
      ],
    });

    expect(projection.performance.map((block) => block.title)).toEqual([
      '你做得好的地方',
      '接下来的判断',
    ]);
    expect(projection.performance[0]?.markdown).toContain('把目标拆成了可观察的行动和结果。');
    expect(projection.performance[0]?.markdown).toContain('识别了生命、能量和回合约束。');
    expect(projection.performance[1]?.markdown).toContain('独立计算复杂场景中的阈值。');
    expect(projection.performance).toHaveLength(2);
  });

  it('keeps core insight at problem-and-method granularity', () => {
    const projection = projectLessonReviewDocument({
      knowledgeMap: { title: '线索', markdown: '问题 → 方法 → 结论' },
      coreInsight: [
        '本课要解决的问题是如何判断多个选项是否构成真正的决策。',
        '核心方法是先检查选项在当前情境中是否具有不同结果。',
        '- 比较机会成本。\n- 检查关键阈值。\n- 检查信息条件。\n- 检查风险后果。\n- 这是应被裁掉的第五项。',
        '因此，表面选项数量不等于有效选择空间。',
        '这一段是后端继续保留、但前端不再铺开的扩展分析。'.repeat(80),
      ].join('\n\n'),
      performance: [
        { title: '你做得好的地方', markdown: '检查了条件。' },
        { title: '接下来的判断', markdown: '继续验证。' },
      ],
    });

    expect(projection.coreInsight).toContain('本课要解决的问题');
    expect(projection.coreInsight).toContain('核心方法');
    expect(projection.coreInsight).toContain('因此');
    expect(projection.coreInsight).not.toContain('第五项');
    expect(projection.coreInsight).not.toContain('扩展分析扩展分析');
  });

  it('keeps only evidence-backed adjacent exploration as an optional module', () => {
    const projection = projectLessonReviewDocument({
      knowledgeMap: { title: '线索', markdown: '问题 → 方法 → 结果' },
      coreInsight: '本课解决如何把问题转成可检验判断。',
      performance: [
        { title: '你做得好的地方', markdown: '检查了关键条件。' },
        { title: '接下来的判断', markdown: '在新案例中独立验证。' },
      ],
      additionalSections: [
        {
          title: '课程邻接探索：局外成长',
          markdown: '讨论中涉及了相关的局外成长设计，但它不替代本课责任。',
        },
        { title: '下一次可使用的检查法', markdown: '后端保留，但不作为邻接模块展示。' },
      ],
    });

    expect(projection.adjacentExploration).toEqual([
      {
        title: '课程邻接探索：局外成长',
        markdown: '讨论中涉及了相关的局外成长设计，但它不替代本课责任。',
      },
    ]);
  });
});
