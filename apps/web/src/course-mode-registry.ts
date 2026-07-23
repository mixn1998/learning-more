import type { CourseMode } from '@learning-more/contracts';

export type CourseModeDefinition = Readonly<{
  id: CourseMode;
  label: string;
  shortLabel: string;
  subtitle: string;
  prompt: string;
  placeholder: string;
  accent: string;
  accentDark: string;
  tint: string;
  icon: string;
  cta: string;
}>;

export const COURSE_MODE_REGISTRY: readonly CourseModeDefinition[] = [
  {
    id: 'standard',
    label: '标准模式',
    shortLabel: '标准',
    subtitle: '系统全面学习掌握',
    prompt: '你想系统学会什么？',
    placeholder: '例如：系统提升游戏设计能力，学会设计有持续吸引力的核心循环',
    accent: '#af6942',
    accentDark: '#78452b',
    tint: '#f7ece5',
    icon: '●',
    cta: '开始学习起点评估',
  },
  {
    id: 'brainstorm',
    label: '头脑风暴',
    shortLabel: '发散',
    subtitle: '快速发现好点子',
    prompt: '你想为哪个问题打开新思路？',
    placeholder: '例如：怎样设计一款成年人愿意每天打开的学习产品',
    accent: '#d2a526',
    accentDark: '#7c6216',
    tint: '#fff9e4',
    icon: '✦',
    cta: '开始探索',
  },
  {
    id: 'argument_clash',
    label: '论证交锋',
    shortLabel: '交锋',
    subtitle: '以辩论呈现思考',
    prompt: '你想检验哪个观点？',
    placeholder: '例如：远程办公究竟提高还是降低知识工作生产率',
    accent: '#58a38f',
    accentDark: '#326b5d',
    tint: '#edf8f4',
    icon: '⇄',
    cta: '开始交锋',
  },
  {
    id: 'case_study',
    label: '案例研习',
    shortLabel: '案例',
    subtitle: '从场景提炼方法',
    prompt: '你想从哪个案例中学到什么？',
    placeholder: '例如：为什么有些产品增长很快却留不住用户',
    accent: '#cb8181',
    accentDark: '#865151',
    tint: '#fff1f1',
    icon: '▣',
    cta: '开始研习',
  },
  {
    id: 'business_insight',
    label: '商业洞察',
    shortLabel: '商业',
    subtitle: '识别价值与机会',
    prompt: '你想看懂哪个行业、产品或机会？',
    placeholder: '例如：中国小众香水行业还有什么新机会',
    accent: '#9b7650',
    accentDark: '#694b31',
    tint: '#f7f0e7',
    icon: '↗',
    cta: '开始洞察',
  },
  {
    id: 'process_decomposition',
    label: '流程拆解',
    shortLabel: '流程',
    subtitle: '把项目变成步骤',
    prompt: '你想把哪件复杂的事拆清楚？',
    placeholder: '例如：从游戏创意到可玩的第一版原型',
    accent: '#6f9fa6',
    accentDark: '#466d73',
    tint: '#edf6f7',
    icon: '→',
    cta: '开始拆解',
  },
  {
    id: 'decision_analysis',
    label: '决策分析',
    shortLabel: '决策',
    subtitle: '用判断推进行动',
    prompt: '你正面对什么重要选择？',
    placeholder: '例如：我是否应该离职转向独立产品开发',
    accent: '#65a07d',
    accentDark: '#416d55',
    tint: '#eef7f1',
    icon: '◇',
    cta: '开始分析',
  },
  {
    id: 'cross_explore',
    label: '交叉探索',
    shortLabel: '交叉',
    subtitle: '从疑惑到真问题',
    prompt: '哪个问题需要跨领域理解？',
    placeholder: '例如：为什么 AI 时代写作反而变得更重要',
    accent: '#78a2e5',
    accentDark: '#4b6fa9',
    tint: '#eff5ff',
    icon: '∞',
    cta: '开始探索',
  },
  {
    id: 'reading_seminar',
    label: '阅读研讨',
    shortLabel: '阅读',
    subtitle: '整合输入与输出',
    prompt: '你想怎样研读这份材料？',
    placeholder: '例如：建立全书结构，并用其中的方法分析一个现实问题',
    accent: '#9079c1',
    accentDark: '#5f4d8b',
    tint: '#f5f1fd',
    icon: '¶',
    cta: '上传材料并开始',
  },
];

export function courseModeDefinition(mode: CourseMode): CourseModeDefinition {
  return COURSE_MODE_REGISTRY.find((definition) => definition.id === mode)!;
}
