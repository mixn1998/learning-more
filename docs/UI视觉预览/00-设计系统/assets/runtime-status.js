(() => {
  const topbar = document.querySelector('.lm-topbar');
  if (!topbar || topbar.querySelector('.lm-global-runtime')) return;
  const states = {
    healthy: { ai: ['ok', 'AI 接口 · Codex', '连接正常'], service: ['ok', '本地服务 · 准备就绪', '实例与版本已核验'] },
    'ai-error': { ai: ['error', 'AI 接口 · 连接失败', '可切换或重新连接'], service: ['ok', '本地服务 · 准备就绪', '服务不受影响'] },
    version: { ai: ['ok', 'AI 接口 · Codex', '连接正常'], service: ['warn', '本地服务 · 版本不一致', '需要同步前端版本'] },
    offline: { ai: ['warn', 'AI 接口 · 状态未知', '需先恢复本地服务'], service: ['error', '本地服务 · 已断开', '等待一键重连或自动恢复'] }
  };
  const readState = () => { try { return localStorage.getItem('lm-runtime-scenario') || 'healthy'; } catch { return 'healthy'; } };
  const scriptUrl = document.currentScript?.src
    || [...document.scripts].find(script => script.src.endsWith('/runtime-status.js'))?.src;
  const uiRootUrl = scriptUrl ? new URL('../../', scriptUrl) : new URL('../', location.href);
  const runtimeUrl = tab => {
    const target = new URL('07-系统运行与自愈/接口状态与本地服务自愈.html', uiRootUrl);
    target.searchParams.set('tab', tab);
    return target.href;
  };
  const createButton = (kind, value) => {
    const [tone, title, detail] = value;
    const button = document.createElement('a');
    button.href = runtimeUrl(kind);
    button.className = `lm-runtime-button ${tone}`;
    button.innerHTML = `<span class="lm-runtime-dot"></span><span><b>${title}</b><small>${detail}</small></span>`;
    return button;
  };
  topbar.querySelectorAll('.lm-runtime').forEach(group => {
    group.querySelectorAll(':scope > *').forEach(item => {
      const text = item.textContent || '';
      if (text.includes('接口') || text.includes('服务准备就绪')) item.remove();
    });
    if (!group.children.length) group.remove();
  });
  const brand = topbar.querySelector('.lm-brand');
  const tools = document.createElement('div');
  tools.className = 'lm-topbar-tools';
  [...topbar.children].filter(child => child !== brand).forEach(child => tools.appendChild(child));
  const runtime = document.createElement('div');
  runtime.className = 'lm-global-runtime';
  const state = states[readState()] || states.healthy;
  runtime.append(createButton('ai', state.ai), createButton('service', state.service));
  tools.prepend(runtime);
  topbar.appendChild(tools);
})();
