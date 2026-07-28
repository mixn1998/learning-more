import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const base = 'http://127.0.0.1:61586';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const failures = [];
const encodeRoute = (relative) => `/${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
async function pageFor(relative) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(`${base}${encodeRoute(relative)}`, { waitUntil: 'networkidle' });
  return page;
}
async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

await check('共享操作反馈', async () => {
  const page = await pageFor('00-设计系统/共享组件与状态色.html');
  await page.locator('[data-demo="primary"]').click();
  await page.locator('.lm-toast.show').waitFor({ state: 'visible' });
  expect((await page.locator('.lm-toast').innerText()).includes('主操作已触发'), '主操作没有反馈');
  await page.close();
});

await check('主页模式、周切换与学习导航', async () => {
  const page = await pageFor('01-主页与全局导航/主页.html');
  await page.locator('[data-mode="reading_seminar"]').click();
  expect((await page.locator('#promptLabel').innerText()).includes('阅读研讨'), '玩法提示未切换');
  expect(await page.locator('#upload').isVisible(), '阅读材料入口未显示');
  const before = await page.locator('#weekRange').innerText();
  await page.locator('#nextWeek').click();
  expect((await page.locator('#weekRange').innerText()) !== before, '周范围未更新');
  await page.locator('#returnWeek').click();
  await page.locator('#continueLearning').click();
  expect(
    await page.locator('#courseChooser').evaluate((dialog) => dialog.open),
    '多课程时未打开课程选择窗口',
  );
  expect(
    (await page.locator('#courseChooserList .course-choice').count()) === 3,
    '课程选择列表未按样例完整渲染',
  );
  expect(
    (await page
      .locator('#courseChooserList .course-choice')
      .first()
      .getAttribute('data-has-in-progress')) === 'true',
    '学习中课程未被优先展示',
  );
  await page.locator('#courseDisciplineFilter').selectOption('计算机科学');
  expect(
    (await page.locator('#courseChooserList .course-choice').count()) === 1,
    '课程领域筛选未生效',
  );
  await page.locator('#courseDisciplineFilter').selectOption('');
  await page.locator('#courseModeFilter').selectOption('案例研习');
  expect(
    (await page.locator('#courseChooserList .course-choice').count()) === 1,
    '课程玩法模式筛选未生效',
  );
  await page.locator('#closeCourseChooser').click();
  await page.locator('.agenda-item').first().click();
  expect(
    await page.locator('#lessonDialog').evaluate((dialog) => dialog.open),
    '学习导航弹窗未打开',
  );
  await page.locator('#closeDialog').click();
  expect(
    !(await page.locator('#lessonDialog').evaluate((dialog) => dialog.open)),
    '学习导航弹窗未关闭',
  );
  await page.close();
  const singleCoursePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await singleCoursePage.goto(`${base}${encodeRoute('01-主页与全局导航/主页.html')}?courses=one`, {
    waitUntil: 'networkidle',
  });
  await singleCoursePage.locator('#continueLearning').click();
  await singleCoursePage.waitForTimeout(200);
  expect(singleCoursePage.url().includes('course=game-loop'), '单课程继续学习未直接进入课程大纲');
  await singleCoursePage.close();
});

const outlinePages = [
  '02-课程创建与大纲/标准模式建档.html',
  ...[
    '头脑风暴',
    '论证交锋',
    '案例研习',
    '商业洞察',
    '流程拆解',
    '决策分析',
    '交叉探索',
    '阅读研讨',
  ].map((name) => `02-课程创建与大纲/八大玩法建档/${name}.html`),
];
for (const relative of outlinePages) {
  await check(`建档对话 ${path.basename(relative)}`, async () => {
    const page = await pageFor(relative);
    const count = await page.locator('.ow-chat > *').count();
    await page.locator('.ow-composer textarea').fill('请根据当前回答继续调整候选大纲');
    await page.locator('.ow-send').click();
    await page.waitForTimeout(760);
    expect((await page.locator('.ow-chat > *').count()) >= count + 2, '发送后未追加用户与 AI 内容');
    await page.locator('.ow-footer .lm-btn.primary').click();
    await page.locator('.lm-confirm').waitFor({ state: 'visible' });
    await page.locator('.lm-confirm button').filter({ hasText: '取消' }).click();
    await page.close();
  });
}

await check('修改大纲对话与发布确认', async () => {
  const page = await pageFor('02-课程创建与大纲/修改大纲.html');
  await page.locator('.ow-composer textarea').fill('强化反馈层级的行为判断');
  await page.locator('.ow-send').click();
  await page.waitForTimeout(760);
  expect(
    (await page.locator('.ow-panel-head span').nth(1).innerText()).includes('候选 04'),
    '候选编号未更新',
  );
  await page.locator('.ow-footer .lm-btn.primary').click();
  expect(await page.locator('.lm-confirm').isVisible(), '发布确认未打开');
  await page.close();
});

await check('正式大纲版本记录', async () => {
  const page = await pageFor('02-课程创建与大纲/正式课程大纲.html');
  expect(
    (await page.locator('.lm-chips').innerText()).includes('推荐但不锁课') === false,
    '说明性标签未移除',
  );
  await page.locator('#switchCourse').click();
  expect(
    await page.locator('#courseChooser').evaluate((dialog) => dialog.open),
    '课程大纲未打开课程选择窗口',
  );
  expect(
    (await page.locator('#courseChooserList [aria-current="page"]').count()) === 1,
    '当前课程没有稳定标识',
  );
  expect(
    (await page.locator('#courseChooserList .course-choice.in-progress').count()) >= 1,
    '学习中课程未突出显示',
  );
  await page.locator('#courseModeFilter').selectOption('阅读研讨');
  expect(
    (await page.locator('#courseChooserList .course-choice').count()) === 1,
    '大纲内课程玩法筛选未生效',
  );
  await page.locator('#closeCourseChooser').click();
  await page.locator('.side-links button').click();
  expect(await page.locator('.version-dialog').evaluate((dialog) => dialog.open), '版本记录未打开');
  await page.locator('.version-dialog footer .lm-btn').click();
  await page.close();
  const deleteCoursePage = await pageFor('02-课程创建与大纲/正式课程大纲.html');
  await deleteCoursePage.locator('#deleteCourse').click();
  expect(
    await deleteCoursePage.locator('#deleteCourseDialog').evaluate((dialog) => dialog.open),
    '删除课程确认弹窗未打开',
  );
  await deleteCoursePage.locator('#cancelDeleteCourse').click();
  expect(
    !(await deleteCoursePage.locator('#deleteCourseDialog').evaluate((dialog) => dialog.open)),
    '取消删除未关闭确认弹窗',
  );
  await deleteCoursePage.locator('#deleteCourse').click();
  await Promise.all([
    deleteCoursePage.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    deleteCoursePage.locator('#confirmDeleteCourse').click(),
  ]);
  expect(
    new URL(deleteCoursePage.url()).searchParams.get('simDeletedCourse') === 'game-loop',
    '永久删除模拟结果未导航到主页',
  );
  await deleteCoursePage.locator('.lm-toast.show').waitFor({ state: 'visible' });
  expect(
    (await deleteCoursePage.locator('.lm-toast').innerText()).includes('永久删除（模拟）'),
    '永久删除模拟结果未在主页显示',
  );
  await deleteCoursePage.close();
  const singleCoursePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await singleCoursePage.goto(
    `${base}${encodeRoute('02-课程创建与大纲/正式课程大纲.html')}?courses=one`,
    { waitUntil: 'networkidle' },
  );
  expect(
    await singleCoursePage.locator('#switchCourse').isHidden(),
    '单课程大纲仍显示切换课程入口',
  );
  await singleCoursePage.close();
});

await check('课程规划筛选、排期与预览', async () => {
  const page = await pageFor('03-课程规划与排期/课程规划.html');
  await page.locator('#statusFilter').selectOption('待规划');
  expect((await page.locator('#summary').innerText()).includes('2 节'), '待规划筛选未按派生状态刷新结果');
  const pendingMeta = await page.locator('.lesson-meta').first().innerText();
  expect(!pendingMeta.includes('2026-'), '课节日期不应在左侧信息流重复显示');
  expect((await page.locator('.lesson-meta .lm-pill').count()) === 4, '状态与主题标签未纳入课节信息流');
  await page.locator('#statusFilter').selectOption('已逾期');
  expect((await page.locator('#summary').innerText()).includes('1 节'), '已逾期筛选未按派生状态刷新结果');
  expect((await page.locator('.schedule-overdue').count()) === 1, '已逾期状态标签未渲染');
  await page.locator('#statusFilter').selectOption('待规划');
  expect((await page.locator('#scheduleDialog').count()) === 0, '排期仍使用二次弹窗');
  const dateTrigger = page.locator('[data-date-trigger]').first();
  await dateTrigger.click();
  expect(
    await page.locator('#datePopover').evaluate((popover) => !popover.hidden),
    '日期选择层未打开',
  );
  const datePickerGeometry = await page.locator('#datePopover').evaluate((popover) => {
    const trigger = document.querySelector('[data-date-trigger]');
    const popoverRect = popover.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return {
      isAbove: popoverRect.bottom <= triggerRect.top - 4,
      isBelow: popoverRect.top >= triggerRect.bottom + 4,
      isInViewport: popoverRect.left >= 0 && popoverRect.top >= 0,
    };
  });
  expect(
    (datePickerGeometry.isAbove || datePickerGeometry.isBelow) && datePickerGeometry.isInViewport,
    `日期选择层未紧贴日期按钮：${JSON.stringify(datePickerGeometry)}`,
  );
  await page.locator('[data-date-cell="2026-07-16"]').click();
  expect(
    (await page.locator('#unplannedCount').innerText()).includes('1'),
    '确认排期后状态计数未更新',
  );
  await page.locator('[data-unschedule]').first().click();
  await page.locator('#statusFilter').selectOption('待规划');
  expect(
    (await page.locator('[data-date-trigger]').first().innerText()).includes('点击安排学习日期'),
    '取消排期后未恢复日期提示',
  );
  await page.locator('[data-preview]').first().click();
  expect(
    await page.locator('#previewDialog').evaluate((dialog) => dialog.open),
    '知识点预览未打开',
  );
  await page.locator('#closePreview').click();
  await page.close();
});

await check('计划流四步向导与管理态', async () => {
  const page = await pageFor('03-课程规划与排期/计划流向导与管理.html');
  expect(
    (await page.locator('#pf-weekly-estimate').innerText()).includes('3 小时 45 分钟'),
    '初始每周时长计算不正确',
  );
  await page.locator('[data-panel="0"] .pf-weekday').first().click();
  expect(
    (await page.locator('#pf-weekly-estimate').innerText()).includes('3 小时'),
    '切换学习日后每周时长未更新',
  );
  await page.locator('#pf-daily-target').fill('120');
  await page.locator('#pf-daily-target').dispatchEvent('input');
  expect(
    (await page.locator('#pf-weekly-estimate').innerText()).includes('8 小时'),
    '自定义时长未参与周时长计算',
  );
  await page.locator('#pf-next').click();
  expect(await page.locator('[data-panel="1"]').isVisible(), '未进入选择课程步骤');
  await page.locator('#pf-course-search').fill('游戏');
  expect((await page.locator('.pf-course:not(.disabled)').count()) >= 1, '课程搜索没有结果');
  await page.locator('#pf-next').click();
  expect(await page.locator('[data-panel="2"]').isVisible(), '未进入排期策略步骤');
  await page.locator('#pf-next').click();
  expect(await page.locator('[data-panel="3"]').isVisible(), '未进入预览确认步骤');
  await page.locator('#pf-next').click();
  await page.waitForTimeout(820);
  expect(await page.locator('#pf-management-view').isVisible(), '确认后未进入计划流管理态');
  await page.locator('#pf-pause').click();
  expect((await page.locator('#pf-status').innerText()) === '已暂停', '暂停状态未更新');
  await page.close();
});

await check('正式学习暂停、发送、停止与结束确认', async () => {
  const page = await pageFor('04-课节学习/正式课程学习会话.html');
  await page.locator('#pauseLearning').click();
  expect(await page.locator('#learningInput').isDisabled(), '暂停后输入框仍可写');
  await page.locator('#pauseLearning').click();
  const users = await page.locator('.learn-user').count();
  await page.locator('#learningInput').fill('我认为反馈必须改变下一次选择。');
  await page.locator('#sendLearning').click();
  await page.waitForTimeout(480);
  expect((await page.locator('.learn-user').count()) === users + 1, '发送后未追加用户消息');
  await page.locator('#stopGeneration').click();
  expect(await page.locator('#stopGeneration').isDisabled(), '停止生成后按钮未锁定');
  await page.locator('#endLesson').click();
  expect(
    await page.locator('#endModal').evaluate((node) => node.classList.contains('open')),
    '结束确认未打开',
  );
  await page.locator('#continueLearning').click();
  await page.close();
});

await check('周回顾折叠、日期与筛选互斥', async () => {
  const page = await pageFor('05-Review与学习档案/上周学习回顾.html');
  expect(
    !(await page.locator('#report').evaluate((node) => node.classList.contains('open'))),
    '周报默认态未收起',
  );
  expect((await page.locator('#symbol').innerText()) === '+', '周报默认折叠符号不是 +');
  expect(
    (await page.locator('#toggle').getAttribute('aria-expanded')) === 'false',
    '周报默认 aria-expanded 不是 false',
  );
  await page.locator('#toggle').click();
  expect(
    await page.locator('#report').evaluate((node) => node.classList.contains('open')),
    '周报点击后未展开',
  );
  expect((await page.locator('#symbol').innerText()) === '−', '周报展开符号不是 −');
  expect(
    (await page.locator('#toggle').getAttribute('aria-expanded')) === 'true',
    '周报展开 aria-expanded 不是 true',
  );
  await page.locator('#toggle').click();
  expect(
    !(await page.locator('#report').evaluate((node) => node.classList.contains('open'))),
    '周报再次点击后未收起',
  );
  expect((await page.locator('#symbol').innerText()) === '+', '周报再次收起符号不是 +');
  expect(
    (await page.locator('#toggle').getAttribute('aria-expanded')) === 'false',
    '周报再次收起 aria-expanded 不是 false',
  );
  await page.locator('.day[data-date="06/29"]').click();
  expect((await page.locator('#summary').innerText()).includes('06/29'), '日期筛选未生效');
  await page.locator('#domain').selectOption('计算机科学');
  expect(!(await page.locator('.day.active').count()), '其他筛选后日期选择未清除');
  await page.close();
});

await check('课节记录 Tab 与补充会话', async () => {
  const page = await pageFor('05-Review与学习档案/课节记录.html');
  await page.locator('[data-tab="review"]').click();
  expect(await page.locator('#reviewPanel').isVisible(), 'Review Tab 未显示');
  await page.locator('[data-tab="chat"]').click();
  await page.locator('[data-session="supplement"]').click();
  expect(await page.locator('#supplement').isVisible(), '补充学习会话未切换');
  await page.close();
});

await check('历史统计范围与课程筛选', async () => {
  const page = await pageFor('06-历史统计与学习画像/历史统计.html');
  await page.locator('[data-range="30d"]').click();
  expect((await page.locator('#metricHours').innerText()) === '12.4 小时', '统计范围未更新指标');
  await page.locator('#courseStatus').selectOption('学习中');
  expect((await page.locator('#courseCount').innerText()) === '1 门课程', '课程状态筛选未生效');
  await page.locator('[data-range="custom"]').click();
  expect(
    await page.locator('#rangeDialog').evaluate((dialog) => dialog.open),
    '自定义日期弹窗未打开',
  );
  await page.locator('#cancelRange').click();
  await page.close();
});

await check('学习日历月份与日期详情', async () => {
  const page = await pageFor('06-历史统计与学习画像/学习日历.html');
  await page.locator('#nextMonth').click();
  expect((await page.locator('#monthLabel').innerText()).includes('8 月'), '下一月未切换');
  await page.locator('#previousMonth').click();
  await page.locator('button.date[data-day="10"]').click();
  expect((await page.locator('#completedCount').innerText()).includes('4 节'), '日期详情未更新');
  expect(
    (await page.locator('button.date[data-day="10"] .date-overflow').innerText()).includes(
      '另有 2 节',
    ),
    '日历溢出摘要未显示',
  );
  await page.close();
});

await check('运行中心切换、模型与诊断', async () => {
  const page = await pageFor('07-系统运行与自愈/接口状态与本地服务自愈.html');
  await page.locator('.rc-tab[data-tab="service"]').click();
  expect(await page.locator('#rc-service-view').isVisible(), '本地服务 Tab 未显示');
  await page.locator('.rc-tab[data-tab="ai"]').click();
  await page.locator('.rc-provider[data-provider="mock"]').click();
  expect((await page.locator('#rc-current-provider').innerText()) === 'Mock', 'Provider 未切换');
  await page.locator('#rc-model-select').selectOption({ index: 1 });
  await page.locator('#rc-switch-model').click();
  await page.waitForTimeout(720);
  expect((await page.locator('#rc-current-model').innerText()).includes('sol'), '模型未切换');
  await page.locator('.rc-tab[data-tab="service"]').click();
  await page.locator('#rc-diagnose-btn').click();
  await page.waitForTimeout(820);
  expect((await page.locator('#rc-heal-status').innerText()) === '无需恢复', '诊断后未恢复健康态');
  await page.close();
});

await browser.close();
if (failures.length) {
  console.error(`Interaction regression failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('Interaction regression passed');
