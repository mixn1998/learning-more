export type VisualSampleState = Readonly<{
  id: string;
  htmlPath: string;
  reactPath: string;
  fixture: string;
}>;

export const VISUAL_SAMPLE_STATES: readonly VisualSampleState[] = [
  {
    id: 'ui-components',
    htmlPath: '00-设计系统/共享组件与状态色.html',
    reactPath: '/__visual/ui-components',
    fixture: 'ui-components',
  },
  {
    id: 'course-modes',
    htmlPath: '00-设计系统/九模式视觉身份.html',
    reactPath: '/__visual/course-modes',
    fixture: 'course-modes',
  },
  { id: 'home', htmlPath: '01-主页与全局导航/主页.html', reactPath: '/', fixture: 'home-ready' },
  {
    id: 'authoring-standard',
    htmlPath: '02-课程创建与大纲/标准模式建档.html',
    reactPath: '/courses/new',
    fixture: 'authoring-standard',
  },
  {
    id: 'authoring-brainstorm',
    htmlPath: '02-课程创建与大纲/八大玩法建档/头脑风暴.html',
    reactPath: '/courses/new',
    fixture: 'authoring-brainstorm',
  },
  {
    id: 'authoring-argument',
    htmlPath: '02-课程创建与大纲/八大玩法建档/论证交锋.html',
    reactPath: '/courses/new',
    fixture: 'authoring-argument-clash',
  },
  {
    id: 'authoring-case',
    htmlPath: '02-课程创建与大纲/八大玩法建档/案例研习.html',
    reactPath: '/courses/new',
    fixture: 'authoring-case-study',
  },
  {
    id: 'authoring-business',
    htmlPath: '02-课程创建与大纲/八大玩法建档/商业洞察.html',
    reactPath: '/courses/new',
    fixture: 'authoring-business-insight',
  },
  {
    id: 'authoring-process',
    htmlPath: '02-课程创建与大纲/八大玩法建档/流程拆解.html',
    reactPath: '/courses/new',
    fixture: 'authoring-process-decomposition',
  },
  {
    id: 'authoring-decision',
    htmlPath: '02-课程创建与大纲/八大玩法建档/决策分析.html',
    reactPath: '/courses/new',
    fixture: 'authoring-decision-analysis',
  },
  {
    id: 'authoring-cross',
    htmlPath: '02-课程创建与大纲/八大玩法建档/交叉探索.html',
    reactPath: '/courses/new',
    fixture: 'authoring-cross-explore',
  },
  {
    id: 'authoring-reading',
    htmlPath: '02-课程创建与大纲/八大玩法建档/阅读研讨.html',
    reactPath: '/courses/new',
    fixture: 'authoring-reading-seminar',
  },
  {
    id: 'course-active',
    htmlPath: '02-课程创建与大纲/正式课程大纲.html',
    reactPath: '/courses/course_game_design',
    fixture: 'course-active',
  },
  {
    id: 'course-revision',
    htmlPath: '02-课程创建与大纲/修改大纲.html',
    reactPath: '/courses/course_game_design',
    fixture: 'course-revision',
  },
  {
    id: 'course-closed',
    htmlPath: '02-课程创建与大纲/已关闭课程大纲.html',
    reactPath: '/courses/course_game_design',
    fixture: 'course-closed',
  },
  {
    id: 'course-lifecycle-confirm',
    htmlPath: '02-课程创建与大纲/课程永久删除确认.html',
    reactPath: '/courses/course_game_design',
    fixture: 'course-lifecycle-confirm',
  },
  {
    id: 'planning',
    htmlPath: '03-课程规划与排期/课程规划.html',
    reactPath: '/planning',
    fixture: 'planning-ready',
  },
  {
    id: 'plan-flow',
    htmlPath: '03-课程规划与排期/计划流向导与管理.html',
    reactPath: '/planning',
    fixture: 'plan-flow-management',
  },
  {
    id: 'lesson-preview',
    htmlPath: '04-课节学习/未开始课节导航.html',
    reactPath: '/courses/course_game_design/lessons/lesson_feedback',
    fixture: 'lesson-not-started',
  },
  {
    id: 'lesson-abandoned',
    htmlPath: '04-课节学习/已放弃课节恢复导航.html',
    reactPath: '/courses/course_game_design/lessons/lesson_feedback',
    fixture: 'lesson-abandoned',
  },
  {
    id: 'lesson-session',
    htmlPath: '04-课节学习/正式课程学习会话.html',
    reactPath: '/courses/course_game_design/lessons/lesson_feedback',
    fixture: 'lesson-session-active',
  },
  {
    id: 'lesson-review-dialog',
    htmlPath: '05-Review与学习档案/课时Review弹窗.html',
    reactPath: '/courses/course_game_design/lessons/lesson_feedback',
    fixture: 'lesson-review-dialog',
  },
  {
    id: 'lesson-record',
    htmlPath: '05-Review与学习档案/课节记录.html',
    reactPath: '/courses/course_game_design/lessons/lesson_feedback/record',
    fixture: 'lesson-record',
  },
  {
    id: 'weekly-report',
    htmlPath: '05-Review与学习档案/上周学习回顾.html',
    reactPath: '/history',
    fixture: 'weekly-report-expanded',
  },
  {
    id: 'course-review',
    htmlPath: '05-Review与学习档案/课程主题总Review.html',
    reactPath: '/courses/course_game_design',
    fixture: 'course-review',
  },
  {
    id: 'history',
    htmlPath: '06-历史统计与学习画像/历史统计.html',
    reactPath: '/history',
    fixture: 'history-statistics',
  },
  {
    id: 'calendar',
    htmlPath: '06-历史统计与学习画像/学习日历.html',
    reactPath: '/history',
    fixture: 'history-calendar',
  },
  {
    id: 'portrait',
    htmlPath: '06-历史统计与学习画像/学习画像.html',
    reactPath: '/profile',
    fixture: 'portrait-completed',
  },
  {
    id: 'runtime',
    htmlPath: '07-系统运行与自愈/接口状态与本地服务自愈.html',
    reactPath: '/runtime',
    fixture: 'runtime-ready',
  },
];
