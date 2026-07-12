(function(){
  const dataNode=document.getElementById('outline-sample-data');if(!dataNode)return;
  const data=JSON.parse(dataNode.textContent);const theme=window.applyCourseModeTheme(data.mode);
  const root=document.getElementById('outline-workspace');
  const homeHref=data.homeHref||'../01-主页与全局导航/主页.html';
  const modules=data.modules.map((m,i)=>`<section class="ow-module"><div class="ow-module-head"><strong>模块 ${i+1} · ${m.title}</strong><span>${i+1}/${data.modules.length}</span></div>${m.lessons.map((l,j)=>`<div class="ow-lesson"><b>${i+1}.${j+1} ${l.title}</b><p>${l.points.join('、')}</p>${l.source?`<div class="ow-source">材料映射：${l.source}</div>`:''}</div>`).join('')}</section>`).join('');
  root.innerHTML=`<header class="lm-topbar"><div class="lm-brand"><strong>Learning MORE</strong><span>学习即生活｜用 AI 重塑学习方式</span></div><div class="lm-runtime"><a class="lm-btn" href="${homeHref}">返回主页</a><span class="lm-pill">● 接口 · Codex</span><span class="lm-pill success">● 建档会话已保存</span></div></header><main class="ow-page"><section class="lm-card ow-hero"><div class="ow-hero-copy"><div class="lm-kicker">${theme.label.toUpperCase()}</div><h1>${theme.label} · 学习档案创建</h1><p>${theme.subtitle}</p></div><div class="ow-hero-mark">${theme.icon}</div></section><div class="ow-steps"><div class="ow-step"><b>01</b>提交主题</div><div class="ow-step active"><b>02</b>学习起点评估</div><div class="ow-step"><b>03</b>候选大纲</div><div class="ow-step"><b>04</b>确认课程</div></div><section class="lm-card ow-initial"><div><strong>来自主页的初始主题</strong><p>${data.topic}</p></div></section>${data.material?`<section class="ow-material"><b>${data.material.name}</b><br>${data.material.status} · ${data.material.detail}</section>`:''}<div class="ow-workbench"><section class="lm-card ow-panel"><header class="ow-panel-head"><strong>学习起点评估</strong><span>${data.status}</span></header><div class="ow-chat"><div class="ow-ai">${data.ai}</div><div class="ow-user"><div class="ow-bubble">${data.user}</div></div><div class="ow-ai">${data.follow}</div></div><div class="ow-composer"><div class="ow-composer-box"><textarea placeholder="继续回答、纠正理解，或要求调整候选大纲……"></textarea><button class="ow-send">↑</button></div></div></section><section class="lm-card ow-panel"><header class="ow-panel-head"><strong>候选大纲</strong><span>完整 Markdown 快照 · 可继续对话调整</span></header><div class="ow-outline"><div class="ow-outline-title"><div><div class="lm-kicker">AI DRAFT</div><h2>${data.outline}</h2><p>${data.summary}</p></div><div class="lm-chips"><span class="lm-pill">${data.discipline}</span>${data.tags.map(t=>`<span class="lm-pill">${t}</span>`).join('')}</div></div>${modules}</div><footer class="ow-footer"><div class="lm-actions"><button class="lm-btn">继续调整</button><button class="lm-btn primary">确认并创建课程</button></div></footer></section></div></main>`;

  const chat=root.querySelector('.ow-chat');
  const textarea=root.querySelector('.ow-composer textarea');
  const sendButton=root.querySelector('.ow-send');
  const statusText=root.querySelector('.ow-panel-head span');
  const footerButtons=[...root.querySelectorAll('.ow-footer .lm-btn')];
  const adjustButton=footerButtons[0];
  const confirmButton=footerButtons[1];
  const formalOutlineHref=location.pathname.includes('/八大玩法建档/')?'../正式课程大纲.html':'正式课程大纲.html';

  async function sendOutlineMessage(){
    const value=textarea.value.trim();
    if(!value){ window.SampleUI?.showToast('请输入要补充或调整的内容','warning'); textarea.focus(); return; }
    const user=document.createElement('div');
    user.className='ow-user';
    user.innerHTML=`<div class="ow-bubble"></div>`;
    user.querySelector('.ow-bubble').textContent=value;
    chat.appendChild(user);
    textarea.value='';
    statusText.textContent='正在根据最新回答调整';
    chat.scrollTop=chat.scrollHeight;
    await window.SampleUI.runSimulation({button:sendButton,busyText:'…',successText:'候选大纲已根据最新回答更新',delay:650});
    const reply=document.createElement('div');
    reply.className='ow-ai';
    reply.textContent=`我已经把“${value.length>34?value.slice(0,34)+'…':value}”纳入当前理解，并调整了候选大纲中的重点与顺序。你可以继续补充，或确认当前版本。`;
    chat.appendChild(reply);
    statusText.textContent='候选大纲已更新';
    chat.scrollTop=chat.scrollHeight;
  }

  sendButton.addEventListener('click',sendOutlineMessage);
  textarea.addEventListener('keydown',(event)=>{
    if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); sendOutlineMessage(); }
  });
  adjustButton.addEventListener('click',()=>{
    textarea.focus();
    textarea.scrollIntoView({behavior:'smooth',block:'center'});
  });
  confirmButton.addEventListener('click',async()=>{
    const accepted=await window.SampleUI.confirm({title:'确认当前课程大纲？',message:'确认后将创建正式课程与可点击课节。',confirmText:'确认创建'});
    if(!accepted) return;
    await window.SampleUI.runSimulation({button:confirmButton,busyText:'正在创建…',successText:'正式课程已创建',delay:750});
    location.href=formalOutlineHref;
  });
})();
