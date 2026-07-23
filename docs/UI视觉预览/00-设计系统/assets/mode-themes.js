(function(){
  const themes={
    standard:{label:'标准模式',subtitle:'系统全面学习掌握',icon:'●',accent:'#af6942',accentDark:'#78452b',tint:'#f7ece5',motif:'editorial',promptTitle:'你想系统学会什么？',placeholder:'例如：系统提升游戏设计能力，学会设计有持续吸引力的核心循环',cta:'开始学习起点评估'},
    brainstorm:{label:'头脑风暴',subtitle:'快速发现好点子',icon:'✦',accent:'#d2a526',accentDark:'#7c6216',tint:'#fff9e4',motif:'burst',promptTitle:'你想为哪个问题打开新思路？',placeholder:'例如：怎样设计一款成年人愿意每天打开的学习产品',cta:'开始探索'},
    argument_clash:{label:'论证交锋',subtitle:'以辩论呈现思考',icon:'⇄',accent:'#58a38f',accentDark:'#326b5d',tint:'#edf8f4',motif:'opposing-lines',promptTitle:'你想检验哪个观点？',placeholder:'例如：远程办公究竟提高还是降低知识工作生产率',cta:'开始交锋'},
    case_study:{label:'案例研习',subtitle:'从场景提炼方法',icon:'▣',accent:'#cb8181',accentDark:'#865151',tint:'#fff1f1',motif:'layers',promptTitle:'你想从哪个案例中学到什么？',placeholder:'例如：为什么有些产品增长很快却留不住用户',cta:'开始研习'},
    business_insight:{label:'商业洞察',subtitle:'识别价值与机会',icon:'↗',accent:'#9b7650',accentDark:'#694b31',tint:'#f7f0e7',motif:'value-path',promptTitle:'你想看懂哪个行业、产品或机会？',placeholder:'例如：中国小众香水行业还有什么新机会',cta:'开始洞察'},
    process_decomposition:{label:'流程拆解',subtitle:'把项目变成步骤',icon:'→',accent:'#6f9fa6',accentDark:'#466d73',tint:'#edf6f7',motif:'flow',promptTitle:'你想把哪件复杂的事拆清楚？',placeholder:'例如：从游戏创意到可玩的第一版原型',cta:'开始拆解'},
    decision_analysis:{label:'决策分析',subtitle:'用判断推进行动',icon:'◇',accent:'#65a07d',accentDark:'#416d55',tint:'#eef7f1',motif:'branch',promptTitle:'你正面对什么重要选择？',placeholder:'例如：我是否应该离职转向独立产品开发',cta:'开始分析'},
    cross_explore:{label:'交叉探索',subtitle:'从疑惑到真问题',icon:'∞',accent:'#78a2e5',accentDark:'#4b6fa9',tint:'#eff5ff',motif:'network',promptTitle:'哪个问题需要跨领域理解？',placeholder:'例如：为什么 AI 时代写作反而变得更重要',cta:'开始探索'},
    reading_seminar:{label:'阅读研讨',subtitle:'整合输入与输出',icon:'¶',accent:'#9079c1',accentDark:'#5f4d8b',tint:'#f5f1fd',motif:'marginalia',promptTitle:'你想怎样研读这份材料？',placeholder:'例如：建立全书结构，并用其中的方法分析一个现实问题',cta:'上传材料并开始'}
  };
  function apply(mode,root=document.documentElement){const theme=themes[mode]||themes.standard;root.style.setProperty('--accent',theme.accent);root.style.setProperty('--accent-dark',theme.accentDark);root.style.setProperty('--tint',theme.tint);root.dataset.courseMode=mode in themes?mode:'standard';return theme}
  window.CourseModeThemeRegistry=Object.freeze(themes);window.applyCourseModeTheme=apply;
})();
