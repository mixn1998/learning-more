import type { CourseMode } from '@learning-more/contracts';

export type CourseModeDefinition = Readonly<{
  id: CourseMode;
  label: string;
  shortLabel: string;
  prompt: string;
  accent: string;
}>;

export const COURSE_MODE_REGISTRY: readonly CourseModeDefinition[] = [
  {
    id: 'standard',
    label: '标准模式',
    shortLabel: '标准',
    prompt: '从主题开始建立系统课程',
    accent: '#5b6ee1',
  },
  {
    id: 'brainstorm',
    label: '头脑风暴',
    shortLabel: '发散',
    prompt: '围绕主题探索多种可能',
    accent: '#8b5cf6',
  },
  {
    id: 'argument_clash',
    label: '观点碰撞',
    shortLabel: '观点',
    prompt: '比较相互冲突的解释',
    accent: '#db5f57',
  },
  {
    id: 'case_study',
    label: '案例研习',
    shortLabel: '案例',
    prompt: '从具体案例进入知识',
    accent: '#d97706',
  },
  {
    id: 'business_insight',
    label: '商业洞察',
    shortLabel: '商业',
    prompt: '理解商业问题与证据',
    accent: '#0f9f76',
  },
  {
    id: 'process_decomposition',
    label: '流程拆解',
    shortLabel: '流程',
    prompt: '拆解过程、约束与反馈',
    accent: '#0891b2',
  },
  {
    id: 'decision_analysis',
    label: '决策分析',
    shortLabel: '决策',
    prompt: '比较选择、风险与权衡',
    accent: '#2563eb',
  },
  {
    id: 'cross_explore',
    label: '跨域探索',
    shortLabel: '跨域',
    prompt: '连接不同领域的知识线索',
    accent: '#7c3aed',
  },
  {
    id: 'reading_seminar',
    label: '阅读研讨',
    shortLabel: '阅读',
    prompt: '基于材料开展可追溯学习',
    accent: '#be185d',
  },
];

export function courseModeDefinition(mode: CourseMode): CourseModeDefinition {
  return COURSE_MODE_REGISTRY.find((definition) => definition.id === mode)!;
}
