import { chromium } from 'playwright-core';
const EXE='/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const pages=['/','/settings','/network','/monologue','/memories','/bucket-list','/life-timeline'];
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const p=await ctx.newPage();
const script=()=>{
  function lum(rgb){const a=rgb.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2];}
  function parse(c){const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;return m[1].split(',').map(parseFloat);}
  function ratio(fg,bg){const L1=lum(fg)+0.05,L2=lum(bg)+0.05;return Math.max(L1,L2)/Math.min(L1,L2);}
  function effBg(el){let e=el;while(e){const b=parse(getComputedStyle(e).backgroundColor);if(b&&(b[3]===undefined||b[3]>0)){if(b[3]!==undefined&&b[3]<1){/*blend over white-ish parent approx*/const pbg=effBg(e.parentElement)||[250,250,245];return b.slice(0,3).map((v,i)=>Math.round(v*b[3]+pbg[i]*(1-b[3])));}return b.slice(0,3);}e=e.parentElement;}return [250,250,245];}
  const bad=[]; let checked=0;
  document.querySelectorAll('a,button,h1,h2,h3,p,span,li,label,div').forEach(el=>{
    const t=el.textContent&&el.children.length===0?el.textContent.trim():'';
    if(!t)return;
    const s=getComputedStyle(el);const fg=parse(s.color);if(!fg)return;
    const bg=effBg(el);const r=ratio(fg.slice(0,3),bg);const size=parseFloat(s.fontSize);const bold=parseInt(s.fontWeight)>=700;
    const large=size>=24||(size>=18.66&&bold);const min=large?3:4.5;checked++;
    if(r<min-0.05)bad.push({t:t.slice(0,24),r:+r.toFixed(2),need:min,size:s.fontSize,color:s.color,tag:el.tagName});
  });
  return {checked,failCount:bad.length,fails:bad.slice(0,15)};
};
for(const path of pages){
  await p.goto('http://localhost:3000'+path,{waitUntil:'commit'});
  await p.waitForTimeout(2500);
  const r=await p.evaluate(script);
  console.log(`\n== ${path} == checked=${r.checked} FAILS=${r.failCount}`);
  r.fails.forEach(f=>console.log(`  ${f.r}:1 (need ${f.need}) "${f.t}" ${f.size} ${f.color} <${f.tag}>`));
}
await b.close();
