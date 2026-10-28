import { chromium } from 'playwright-core';
const EXE='/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:3000/memories',{waitUntil:'load'});
await p.waitForTimeout(4500);
// wait until '불러오는' gone
try{ await p.waitForFunction(()=>!document.body.innerText.includes('불러오는'),{timeout:8000}); }catch{}
await p.screenshot({path:'/workspace/docs/design/_assets_v2/after-memories.png'});
const r=await p.evaluate(()=>({txt:document.body.innerText.slice(0,60), chips:document.querySelectorAll('.chip').length}));
console.log(JSON.stringify(r));
await b.close();
