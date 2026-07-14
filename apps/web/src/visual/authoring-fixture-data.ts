import type { OutlineWorkspaceData } from '../features/course-authoring/outline-workspace-view.js';

export const AUTHORING_FIXTURE_DATA = {
  'authoring-standard': {
    mode: 'standard',
    topic: '系统提升游戏设计能力，能够设计有持续吸引力的核心循环',
    status: '正在核对当前经验与目标',
    ai: '你做过的简单游戏中，哪一个体验最接近你想继续发展的方向？你觉得它好玩或不好玩的依据是什么？',
    user: '我做过一个平台跳跃原型。操作还算顺手，但玩家三分钟后就会觉得重复，我说不清问题出在哪里。',
    follow:
      '我目前的理解是：你并非从零开始，已经能完成可玩的原型；真正缺口在于从玩家行为识别体验断点，并把判断推进为可验证的核心循环设计。若这不准确，你可以直接纠正。',
    outline: '从反馈到核心循环：游戏设计能力进阶',
    summary: '从玩家行为证据出发，建立反馈、动机、循环与原型验证之间的完整知识主线。',
    discipline: '艺术与设计',
    tags: ['游戏设计', '核心循环'],
    modules: [
      {
        title: '看见体验断点',
        lessons: [
          { title: '玩家为什么会停下来', points: ['重复感的来源', '目标推进', '行为证据'] },
        ],
      },
      {
        title: '建立核心循环',
        lessons: [
          { title: '反馈如何改变下一步行动', points: ['状态反馈', '能力反馈', '目标反馈'] },
        ],
      },
      {
        title: '用原型验证判断',
        lessons: [{ title: '建立可验证的成功标准', points: ['观察指标', '测试任务', '迭代决策'] }],
      },
    ],
  },
  'authoring-brainstorm': {
    mode: 'brainstorm',
    topic: '怎样设计一款成年人愿意每天打开的学习产品',
    status: '正在理解已有想法与卡点',
    ai: '你现在最想突破的是没有想法，还是已经有几个方向但都觉得相似？先说说哪些方向你已经不想再重复。',
    user: '我想到打卡、积分和社群，但感觉只是把常见机制重新组合。',
    follow:
      '我们暂时不继续堆功能。若用户每天打开它不是为了完成任务，而是为了重新看见自己的变化，这款产品可能提供什么不同体验？',
    outline: '让学习产品产生每日回访价值',
    summary: '从真实动机、成长反馈和可验证原型建立产品判断。',
    discipline: '产品设计',
    tags: ['学习产品', '用户动机'],
    modules: [
      {
        title: '理解每日回访的真实动机',
        lessons: [{ title: '用户为什么愿意回来', points: ['任务压力', '成长可见性', '身份认同'] }],
      },
      {
        title: '重新理解反馈',
        lessons: [{ title: '反馈如何改变判断', points: ['新信息', '下一步选择', '反馈衰减'] }],
      },
      {
        title: '形成并验证方向',
        lessons: [{ title: '从候选体验到原型', points: ['体验假设', '行为指标', '验证边界'] }],
      },
    ],
  },
  'authoring-argument-clash': {
    mode: 'argument_clash',
    topic: '远程办公究竟提高还是降低知识工作生产率',
    status: '正在澄清命题、尺度与证据',
    ai: '你目前更倾向哪一边？请先给出最强理由，以及什么证据可能让你改变判断。',
    user: '我倾向提高，因为少了通勤和办公室打断，但长期协作可能会变差。',
    follow:
      '你的主张包含至少两个时间尺度。我们先区分个人即时产出、团队协作成本和长期知识积累，再判断生产率是否能被一个指标覆盖。',
    outline: '远程办公与知识工作生产率',
    summary: '从概念、证据和反方解释形成可修正的条件化判断。',
    discipline: '社会科学',
    tags: ['远程办公', '组织协作'],
    modules: [
      {
        title: '界定争论对象',
        lessons: [{ title: '什么算生产率', points: ['个人产出', '团队协作', '组织学习'] }],
      },
      {
        title: '检验证据与解释',
        lessons: [{ title: '证据真正说明什么', points: ['测量偏差', '替代解释', '因果边界'] }],
      },
      {
        title: '形成有边界的结论',
        lessons: [{ title: '在什么条件下成立', points: ['强反方', '证据缺口', '命题修订'] }],
      },
    ],
  },
  'authoring-case-study': {
    mode: 'case_study',
    topic: '为什么有些产品增长很快却留不住用户',
    status: '正在确认案例范围与迁移目标',
    ai: '你希望研究一个具体产品，还是比较几种增长后快速流失的情境？更关心获客承诺、首次体验还是长期价值？',
    user: '先从一个具体失败产品入手，再看能否迁移到自己的工具产品。',
    follow:
      '我们会保留当时可获得的信息，让你在关键决策点先判断，再用结果检验推理，避免事后看一切都显得理所当然。',
    outline: '从高速增长到用户流失：案例机制研习',
    summary: '在真实约束中重建决策，并提炼可迁移的留存机制。',
    discipline: '产品管理',
    tags: ['用户留存', '产品增长'],
    modules: [
      {
        title: '重建案例现场',
        lessons: [{ title: '增长发生时看见了什么', points: ['产品承诺', '用户来源', '关键约束'] }],
      },
      {
        title: '定位体验断裂',
        lessons: [{ title: '关键决策点', points: ['首次价值', '行为变化', '流失信号'] }],
      },
      {
        title: '提炼迁移机制',
        lessons: [{ title: '适用条件与反例', points: ['机制提炼', '迁移边界', '反事实'] }],
      },
    ],
  },
  'authoring-business-insight': {
    mode: 'business_insight',
    topic: '中国小众香水行业还有什么新机会',
    status: '正在区分热度、需求与价值获取',
    ai: '你更想理解行业全景、寻找创业机会，还是判断某个品牌？目前让你觉得有机会的信号是什么？',
    user: '年轻人愿意为气味表达付费，但我不知道这是不是短期潮流。',
    follow:
      '我们需要把愿意表达拆成使用场景、购买频率、替代方案和价值获取方式，再判断哪些信号支持长期需求，哪些只是热度。',
    outline: '小众香水行业的价值结构与机会验证',
    summary: '从客户场景、价值链和反证建立商业机会判断。',
    discipline: '商业与管理',
    tags: ['香水行业', '机会验证'],
    modules: [
      {
        title: '理解需求与场景',
        lessons: [{ title: '用户为什么购买', points: ['身份表达', '礼赠场景', '日常使用'] }],
      },
      {
        title: '看见价值链与竞争',
        lessons: [{ title: '价值如何流动', points: ['品牌', '渠道', '供应链'] }],
      },
      {
        title: '形成机会验证',
        lessons: [{ title: '什么证据会推翻机会', points: ['机会假设', '关键风险', '低成本验证'] }],
      },
    ],
  },
  'authoring-process-decomposition': {
    mode: 'process_decomposition',
    topic: '从游戏创意到可玩的第一版原型',
    status: '正在澄清完成标准与约束',
    ai: '第一版原型要验证核心操作、玩家乐趣还是完整内容？你有哪些资源和不可改变的时间限制？',
    user: '两周内验证核心循环，只有我一个人，程序和美术能力都一般。',
    follow: '流程不应按完整游戏生产拆解，而应围绕最早获得核心循环证据来组织依赖、取舍和检查点。',
    outline: '两周完成可验证游戏原型',
    summary: '围绕核心循环证据拆解依赖、关键路径与异常处理。',
    discipline: '项目管理',
    tags: ['游戏原型', '流程设计'],
    modules: [
      {
        title: '定义完成标准',
        lessons: [{ title: '什么必须进入原型', points: ['验证目标', '最小范围', '完成条件'] }],
      },
      {
        title: '建立关键路径',
        lessons: [{ title: '两周执行路径', points: ['前后依赖', '并行工作', '最大瓶颈'] }],
      },
      {
        title: '设计测试与返工',
        lessons: [{ title: '原型如何给出证据', points: ['玩家行为', '失败分支', '迭代节奏'] }],
      },
    ],
  },
  'authoring-decision-analysis': {
    mode: 'decision_analysis',
    topic: '我是否应该离职转向独立产品开发',
    status: '正在澄清目标、风险与可逆性',
    ai: '你希望这个决定优化收入上限、自主性、成长速度还是生活状态？哪些风险可以承担，哪些后果不可接受？',
    user: '最看重自主性，但至少要维持一年的基本生活，而且不确定产品能不能找到用户。',
    follow:
      '先区分不可逆风险和可通过小实验降低的不确定性，再判断是否真的只有离职或不离职两个选项。',
    outline: '从职业稳定到独立产品：可验证的转向决策',
    summary: '澄清目标、扩展选项，并用实验降低关键不确定性。',
    discipline: '职业发展',
    tags: ['独立开发', '决策'],
    modules: [
      {
        title: '明确决策目标',
        lessons: [{ title: '真正优化什么', points: ['自主性', '收入安全', '成长速度'] }],
      },
      {
        title: '展开选项与风险',
        lessons: [{ title: '哪些风险可逆', points: ['阶段转向', '机会成本', '最坏情况'] }],
      },
      {
        title: '设计验证路径',
        lessons: [{ title: '何时重新决策', points: ['小实验', '信息价值', '触发条件'] }],
      },
    ],
  },
  'authoring-cross-explore': {
    mode: 'cross_explore',
    topic: '为什么 AI 时代写作反而变得更重要',
    status: '正在识别问题层级与已有视角',
    ai: '你说的更重要是职业竞争、思考能力、表达身份还是知识生产？你目前主要从哪个角度理解？',
    user: '原来从效率看，但越来越觉得写作是组织思考和形成个人判断。',
    follow:
      '我们可以连接认知、传播、组织知识和身份表达，但重点不是堆学科，而是检验这些视角是否共同改变了写作是什么。',
    outline: 'AI 时代写作的认知、社会与身份价值',
    summary: '通过多个分析层级重构写作价值，而非罗列学科观点。',
    discipline: '跨学科研究',
    tags: ['AI 与写作', '认知'],
    modules: [
      {
        title: '重新定义写作',
        lessons: [{ title: '写作是否只是输出', points: ['思考', '记忆', '判断'] }],
      },
      {
        title: '切换分析层级',
        lessons: [{ title: '不同视角解释什么', points: ['个人认知', '协作传播', '社会身份'] }],
      },
      {
        title: '形成综合判断',
        lessons: [{ title: 'AI 改变了什么', points: ['类比边界', '互补解释', '新问题'] }],
      },
    ],
  },
  'authoring-reading-seminar': {
    mode: 'reading_seminar',
    topic: '系统理解《系统思考》，并能用于分析组织问题',
    status: '材料已解析 · 正在评估阅读起点',
    material: {
      name: '《系统思考》节选.pdf',
      status: '解析成功',
      detail: '12 章 · 286 页 · 章节层级可信',
    },
    ai: '材料已解析为 12 个章节。你是第一次系统阅读，还是读过部分内容？希望建立全书结构、解决现实问题，还是形成输出？',
    user: '读过前两章但很零散。我想建立全书框架，并用它分析团队反复救火的问题。',
    follow:
      '我会把原文章节作为内容主线，同时补足反馈回路与系统边界基础，再把相关章节合并到团队案例中验证；不会机械地一章一课。',
    outline: '《系统思考》结构化研读与组织问题应用',
    summary: '按原文章节建立知识主线，并将系统概念迁移到团队救火问题。',
    discipline: '系统科学',
    tags: ['系统思考', '组织问题'],
    modules: [
      {
        title: '建立全书问题地图',
        lessons: [
          {
            title: '系统为何反复产生相同结果',
            points: ['系统边界', '事件与结构', '问题意识'],
            source: '第 1–3 章 · 从事件到系统结构',
          },
        ],
      },
      {
        title: '读懂反馈与延迟',
        lessons: [
          {
            title: '增强与调节回路',
            points: ['因果连接', '回路行为', '时间延迟'],
            source: '第 4–8 章 · 反馈回路与延迟',
          },
        ],
      },
      {
        title: '从阅读到应用',
        lessons: [
          {
            title: '建立自己的系统图',
            points: ['杠杆点', '原文证据', '个人推断'],
            source: '第 9–12 章 · 杠杆点与实践',
          },
        ],
      },
    ],
  },
} as const satisfies Readonly<Record<string, OutlineWorkspaceData>>;

export type AuthoringFixtureId = keyof typeof AUTHORING_FIXTURE_DATA;

export function isAuthoringFixtureId(value: string): value is AuthoringFixtureId {
  return Object.hasOwn(AUTHORING_FIXTURE_DATA, value);
}
