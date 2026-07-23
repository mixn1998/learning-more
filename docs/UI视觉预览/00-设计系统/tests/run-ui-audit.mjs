import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
const productDomains = fs
  .readdirSync(uiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^0[1-7]-/.test(entry.name))
  .map((entry) => path.join(uiRoot, entry.name));

const forbiddenVisibleCopy = [
  '固定大弹窗四步向导',
  '点击顶部步骤或使用底部按钮切换',
  '样稿说明',
  '交互说明',
  '预览说明',
  '当前模式只提供整体体验语境',
  '玩法只提供整体体验意图',
  '不下发方法清单或固定课程结构',
  '课程不会机械映射玩法名称或固定步骤',
  '需要调整目标或范围时，直接在下方与 AI 对话',
  '返回主页重新选择模式',
  '标准模式与八大玩法',
  '点击课节先查看核心知识点，再决定是否进入学习',
  '开始学习前 · 课节导航',
  '先了解本课将建立的核心判断。关闭不会创建学习会话',
  '确认后才原子创建正式课程与课节列表',
  '此处只用于规划预览',
  '关闭不会撤销完成事实，也不会删除 Review',
  '查看真实发生的学习事实，并从课程清单返回相应学习档案',
  '只记录已完成并归档的课节',
  '不需要匹配固定栏目或写作模板',
  'AI可以在这里自由选择段落',
  '本课将围绕这一知识点建立可用于理解、判断和应用的核心认识',
];

function walkHtml(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkHtml(target);
    return entry.isFile() && entry.name.endsWith('.html') ? [target] : [];
  });
}

const failures = [];
for (const file of productDomains.flatMap(walkHtml)) {
  const html = fs.readFileSync(file, 'utf8');
  const relative = path.relative(uiRoot, file);
  if (!/^\s*<!doctype html>/i.test(html)) {
    failures.push(`${relative}: 缺少 <!doctype html>`);
  }
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) {
    failures.push(`${relative}: 缺少完整 html/body 页面外壳`);
  }
  if (!/sample-ui\.js/.test(html)) {
    failures.push(`${relative}: 未接入共享交互运行时 sample-ui.js`);
  }
  for (const copy of forbiddenVisibleCopy) {
    if (html.includes(copy)) failures.push(`${relative}: 残留样稿说明「${copy}」`);
  }
}

for (const sharedFile of ['outline-workspace.js', 'mode-themes.js']) {
  const file = path.join(uiRoot, '00-设计系统', 'assets', sharedFile);
  const source = fs.readFileSync(file, 'utf8');
  for (const copy of forbiddenVisibleCopy) {
    if (source.includes(copy)) failures.push(`00-设计系统/assets/${sharedFile}: 共享渲染仍包含说明「${copy}」`);
  }
}

if (failures.length) {
  console.error(`UI audit failed (${failures.length})`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`UI audit passed: ${productDomains.flatMap(walkHtml).length} product pages`);
