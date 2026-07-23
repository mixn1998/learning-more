import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const testsDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(testsDir, '..', '..');
const base = 'http://127.0.0.1:61586';
const viewports = [['desktop',{width:1440,height:1000}],['tablet',{width:1024,height:768}],['mobile',{width:390,height:844}]];

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
      const visible=(node)=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0};
      const report=[];
      if(document.documentElement.scrollWidth>innerWidth+4)report.push(`page-horizontal-overflow=${document.documentElement.scrollWidth}/${innerWidth}`);
      document.querySelectorAll('.lm-card,.insight-card,.portrait-summary,.review-dialog,.nav-modal,.pf-dialog,.rc-panel,.ow-panel').forEach((node)=>{
        if(!visible(node))return;
        const style=getComputedStyle(node);
        if(style.overflowX==='hidden'&&node.scrollWidth>node.clientWidth+4)report.push(`${node.className}: clipped-x=${node.scrollWidth}/${node.clientWidth}`);
        if(style.overflowY==='hidden'&&node.scrollHeight>node.clientHeight+4)report.push(`${node.className}: clipped-y=${node.scrollHeight}/${node.clientHeight}`);
      });
      document.querySelectorAll('.lm-page,.home-hero,.hero,.main-head,.schedule-head,.review-dialog-head,.insight-card,.ow-hero,.ow-initial,.pf-dialog-head,.rc-head').forEach((parent)=>{
        if(!visible(parent))return;
        const children=[...parent.children].filter((node)=>visible(node)&&!['absolute','fixed'].includes(getComputedStyle(node).position));
        for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++){
          const a=children[i].getBoundingClientRect(),b=children[j].getBoundingClientRect();
          const overlapX=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const overlapY=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
          if(overlapX*overlapY>16)report.push(`${parent.className||parent.tagName}: sibling-overlap “${children[i].textContent.trim().slice(0,18)}” / “${children[j].textContent.trim().slice(0,18)}”`);
        }
      });
      const groups=[
        ['.home-hero>div:first-child',['.lm-kicker','h1','.home-prompt']],
        ['.hero>div:first-child',['.lm-kicker','h1']],
        ['.dialog-head',['.lm-kicker','h2']],
        ['.ow-hero-copy',['.lm-kicker','h1','p']],
      ];
      groups.forEach(([selector,items])=>document.querySelectorAll(selector).forEach((group)=>{
        const nodes=items.map((item)=>group.querySelector(item)).filter((node)=>node&&visible(node));
        if(nodes.length<2)return;
        const lefts=nodes.map((node)=>Math.round(node.getBoundingClientRect().left));
        if(Math.max(...lefts)-Math.min(...lefts)>4)report.push(`${selector}: left-edge-mismatch=${lefts.join('/')}`);
      }));
      return [...new Set(report)];
    });
    result.forEach((failure)=>failures.push(`${relative} [${viewportName}] ${failure}`));
    await page.close();
  }
}

await browser.close();
if(failures.length){console.error(`Module geometry failed (${failures.length})`);failures.forEach((failure)=>console.error(`- ${failure}`));process.exit(1)}
console.log(`Module geometry passed: ${files.length} pages × ${viewports.length} viewports`);
