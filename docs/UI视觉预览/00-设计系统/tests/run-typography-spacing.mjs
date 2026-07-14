import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const { chromium }=require('@playwright/test');
const testsDir=path.dirname(fileURLToPath(import.meta.url));
const uiRoot=path.resolve(testsDir,'..','..');
const base='http://127.0.0.1:61586';
const viewports=[['desktop',{width:1440,height:1000}],['tablet',{width:1024,height:768}],['mobile',{width:390,height:844}]];
function walkHtml(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap((entry)=>{const target=path.join(directory,entry.name);if(entry.isDirectory())return walkHtml(target);return entry.isFile()&&entry.name.endsWith('.html')?[target]:[]})}
const files=fs.readdirSync(uiRoot,{withFileTypes:true}).filter((entry)=>entry.isDirectory()&&/^0[0-7]-/.test(entry.name)).flatMap((entry)=>walkHtml(path.join(uiRoot,entry.name)));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const failures=[];

for(const file of files){
  const relative=path.relative(uiRoot,file);
  const route=`/${relative.split(path.sep).map(encodeURIComponent).join('/')}`;
  for(const [viewportName,viewport] of viewports){
    const page=await browser.newPage({viewport});
    await page.goto(`${base}${route}`,{waitUntil:'domcontentloaded'});
    const result=await page.evaluate(()=>{
      const report=[];
      const visible=(node)=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const ownText=(node)=>[...node.childNodes].filter((item)=>item.nodeType===Node.TEXT_NODE).map((item)=>item.textContent).join(' ').trim();
      const textSelector='h1,h2,h3,h4,p,small,label,button,a,.lm-pill,.lm-kicker,.lm-tab,input,textarea,select,li';
      document.querySelectorAll(textSelector).forEach((node)=>{
        if(!visible(node))return;
        const text=(ownText(node)||(['INPUT','TEXTAREA','SELECT'].includes(node.tagName)?node.value||node.placeholder||'':'')||'').replace(/\s+/g,' ').trim();
        if(!text&&!['INPUT','TEXTAREA','SELECT'].includes(node.tagName))return;
        const style=getComputedStyle(node),size=parseFloat(style.fontSize),line=parseFloat(style.lineHeight);
        const minimum=node.matches('h1')?24:node.matches('h2')?18:node.matches('h3')?14:node.matches('small')?10:node.matches('.lm-btn,.lm-tab,.lm-control,.pf-btn,.rc-btn,.history-tab,button')?11:10;
        if(size+0.1<minimum)report.push(`small-type ${node.tagName}.${node.className}: ${size}px < ${minimum}px “${text.slice(0,30)}”`);
        if(Number.isFinite(line)&&line/size<1.2)report.push(`tight-line ${node.tagName}.${node.className}: ${(line/size).toFixed(2)} “${text.slice(0,30)}”`);
        const overflowX=node.scrollWidth>node.clientWidth+3;
        const overflowY=node.scrollHeight>node.clientHeight+3;
        if((overflowX||overflowY)&&['hidden','clip'].includes(style.overflow))report.push(`clipped-text ${node.tagName}.${node.className}: ${node.scrollWidth}/${node.clientWidth} × ${node.scrollHeight}/${node.clientHeight}`);
      });
      document.querySelectorAll('.lm-btn,.lm-tab,.lm-control,.pf-btn,.rc-btn,.history-tab').forEach((node)=>{
        if(!visible(node))return;
        const rect=node.getBoundingClientRect();
        const text=node.textContent.trim();
        const iconOnly=node.getAttribute('aria-label')&&text.length<=2;
        if(!iconOnly&&rect.height<38)report.push(`small-hit-area ${node.className}: ${Math.round(rect.height)}px “${text.slice(0,30)}”`);
      });
      document.querySelectorAll('.hero,.dialog-head,.dialog-body,.dialog-foot,.nav-head,.nav-body,.nav-foot,.review-dialog-head,.review-scroll,.review-dialog-foot').forEach((node)=>{
        if(!visible(node))return;
        const style=getComputedStyle(node),left=parseFloat(style.paddingLeft),right=parseFloat(style.paddingRight);
        if(Math.abs(left-right)>2)report.push(`uneven-padding ${node.className}: ${left}/${right}`);
        if(left<10||right<10)report.push(`thin-padding ${node.className}: ${left}/${right}`);
      });
      return [...new Set(report)];
    });
    result.forEach((failure)=>failures.push(`${relative} [${viewportName}] ${failure}`));
    await page.close();
  }
}
await browser.close();
if(failures.length){console.error(`Typography/spacing failed (${failures.length})`);failures.forEach((failure)=>console.error(`- ${failure}`));process.exit(1)}
console.log(`Typography/spacing passed: ${files.length} pages × ${viewports.length} viewports`);
