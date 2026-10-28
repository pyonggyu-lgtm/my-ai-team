import { chromium } from 'playwright-core';
const EXE='/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const p=await b.newPage({viewport:{width:1440,height:900}});
for(const [path,name] of [['/','home'],['/settings','settings'],['/network','network']]){
  await p.goto('http://localhost:3000'+path,{waitUntil:'commit'});
  await p.waitForTimeout(2500);
  await p.screenshot({path:`/workspace/docs/design/_assets_v2/after-${name}.png`});
}
await b.close(); console.log('shots done');
