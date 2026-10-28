import { chromium } from 'playwright-core';
import fs from 'fs';

const EXE = '/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const URL = 'https://digital-memoir-chi.vercel.app';
const OUT = '/workspace/docs/research/_assets';
fs.mkdirSync(OUT, { recursive: true });

const report = { url: URL, capturedAt: new Date().toISOString(), viewports: {}, };

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const context = await browser.newContext();
const page = await context.newPage();

const consoleMsgs = [];
page.on('console', m => consoleMsgs.push({ type: m.type(), text: m.text().slice(0, 300) }));
page.on('pageerror', e => consoleMsgs.push({ type: 'pageerror', text: String(e).slice(0, 300) }));

// ---- load + perf ----
const t0 = Date.now();
const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
report.httpStatus = resp?.status();
report.loadMs = Date.now() - t0;
await page.waitForTimeout(1500);

// perf timing + resources
report.perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource').map(r => ({
    name: r.name, type: r.initiatorType, size: r.transferSize, dur: Math.round(r.duration),
  }));
  const paints = performance.getEntriesByType('paint').map(p => ({ name: p.name, t: Math.round(p.startTime) }));
  const byType = {};
  let total = 0;
  for (const r of res) { byType[r.type] = (byType[r.type] || 0) + (r.size || 0); total += (r.size || 0); }
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    loadEvent: Math.round(nav.loadEventEnd || 0),
    transferBytesByType: byType,
    transferBytesTotal: total,
    resourceCount: res.length,
    paints,
    largest: res.sort((a,b)=>(b.size||0)-(a.size||0)).slice(0,12),
  };
});

// meta / head info
report.head = await page.evaluate(() => ({
  title: document.title,
  lang: document.documentElement.lang || null,
  viewport: document.querySelector('meta[name=viewport]')?.content || null,
  description: document.querySelector('meta[name=description]')?.content || null,
  charset: document.characterSet,
  favicon: !!document.querySelector('link[rel*=icon]'),
}));

// full DOM outline: headings, landmarks, interactive
report.structure = await page.evaluate(() => {
  const txt = el => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ tag: h.tagName, text: txt(h) }));
  const landmarks = [...document.querySelectorAll('header,nav,main,footer,aside,section[aria-label],[role]')]
    .map(e => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), label: e.getAttribute('aria-label') })).slice(0,40);
  const buttons = [...document.querySelectorAll('button,a[href],[role=button]')].map(b => ({
    tag: b.tagName.toLowerCase(), text: txt(b), href: b.getAttribute('href'),
    hasLabel: !!(b.getAttribute('aria-label') || txt(b)),
  })).slice(0, 60);
  const imgs = [...document.querySelectorAll('img')].map(i => ({
    src: (i.currentSrc||i.src||'').slice(-60), alt: i.getAttribute('alt'), hasAlt: i.hasAttribute('alt'),
    w: i.naturalWidth, h: i.naturalHeight, dw: i.width, dh: i.height,
  }));
  const inputs = [...document.querySelectorAll('input,textarea,select')].map(i => ({
    type: i.type, hasLabel: !!(i.labels?.length || i.getAttribute('aria-label') || i.getAttribute('placeholder')),
    placeholder: i.getAttribute('placeholder'),
  }));
  return { headingCount: headings.length, headings, landmarks, buttonCount: buttons.length, buttons, imgCount: imgs.length, imgs, inputs };
});

// typography + color palette sampling
report.styles = await page.evaluate(() => {
  const cs = el => getComputedStyle(el);
  const body = cs(document.body);
  const sample = sel => { const e = document.querySelector(sel); if (!e) return null; const s = cs(e);
    return { fontSize: s.fontSize, lineHeight: s.lineHeight, fontFamily: s.fontFamily.slice(0,60), fontWeight: s.fontWeight, color: s.color, letterSpacing: s.letterSpacing }; };
  // collect distinct colors + bg
  const colors = new Map(), bgs = new Map(), fonts = new Map(), sizes = new Map();
  [...document.querySelectorAll('*')].slice(0, 2000).forEach(e => {
    const s = cs(e);
    colors.set(s.color, (colors.get(s.color)||0)+1);
    if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)') bgs.set(s.backgroundColor, (bgs.get(s.backgroundColor)||0)+1);
    fonts.set(s.fontFamily.split(',')[0].replace(/"/g,''), (fonts.get(s.fontFamily.split(',')[0])||0)+1);
    if (e.textContent && e.children.length===0) sizes.set(s.fontSize, (sizes.get(s.fontSize)||0)+1);
  });
  const top = m => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12);
  return {
    bodyFont: body.fontFamily.slice(0,80), bodyBg: body.backgroundColor, bodyColor: body.color,
    bodyFontSize: body.fontSize, bodyLineHeight: body.lineHeight,
    h1: sample('h1'), h2: sample('h2'), p: sample('p'), button: sample('button, a'),
    topTextColors: top(colors), topBgColors: top(bgs), topFonts: top(fonts), topFontSizes: top(sizes),
  };
});

// tap target / small-target check (mobile ergonomics) at current desktop first
async function smallTargets() {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('button,a[href],[role=button],input,select')];
    const small = [];
    els.forEach(e => { const r = e.getBoundingClientRect(); if (r.width>0 && (r.width<44||r.height<44)) small.push({ tag:e.tagName.toLowerCase(), text:(e.textContent||'').trim().slice(0,30), w:Math.round(r.width), h:Math.round(r.height) }); });
    return { total: els.length, smallCount: small.length, examples: small.slice(0,15) };
  });
}

// contrast check (basic) for text nodes
report.contrast = await page.evaluate(() => {
  function lum(rgb){ const a=rgb.map(v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);}); return 0.2126*a[0]+0.7152*a[1]+0.0722*a[2]; }
  function parse(c){ const m=c.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(',').map(s=>parseFloat(s)); return p; }
  function ratio(fg,bg){ const L1=lum(fg)+0.05, L2=lum(bg)+0.05; return (Math.max(L1,L2)/Math.min(L1,L2)); }
  function effBg(el){ let e=el; while(e){ const b=getComputedStyle(e).backgroundColor; const p=parse(b); if(p && (p[3]===undefined||p[3]>0)) return p; e=e.parentElement;} return [255,255,255]; }
  const bad=[]; let checked=0;
  [...document.querySelectorAll('p,span,a,button,h1,h2,h3,h4,h5,h6,li,td,label')].slice(0,600).forEach(el=>{
    if(!el.textContent.trim()||el.children.length>0) return;
    const s=getComputedStyle(el); const fg=parse(s.color); const bg=effBg(el); if(!fg) return; checked++;
    const r=ratio(fg.slice(0,3),bg.slice(0,3)); const size=parseFloat(s.fontSize); const bold=parseInt(s.fontWeight)>=700;
    const large=size>=24||(size>=18.66&&bold); const min=large?3:4.5;
    if(r<min) bad.push({ text:el.textContent.trim().slice(0,40), ratio:+r.toFixed(2), need:min, fontSize:s.fontSize, color:s.color });
  });
  return { checked, failCount: bad.length, examples: bad.slice(0,20) };
});

// ---- multi-viewport screenshots + overflow check ----
const viewports = { desktop: [1440, 900], tablet: [768, 1024], mobile: [375, 812] };
for (const [name, [w, h]] of Object.entries(viewports)) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const info = await page.evaluate((vw) => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth > window.innerWidth + 2;
    // find elements wider than viewport
    const wide = [];
    [...document.querySelectorAll('*')].forEach(e => { const r=e.getBoundingClientRect(); if (r.right > vw + 2 && r.width>0) wide.push({ tag:e.tagName.toLowerCase(), cls:(e.className&&e.className.toString().slice(0,30)), right:Math.round(r.right) }); });
    return { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, docHeight: de.scrollHeight, overflowX, wideCount: wide.length, wideExamples: wide.slice(0,8) };
  }, w);
  info.smallTargets = await smallTargets();
  report.viewports[name] = info;
}

report.console = consoleMsgs.slice(0, 40);

fs.writeFileSync('/workspace/docs/research/_assets/audit.json', JSON.stringify(report, null, 2));
console.log('DONE. status=%s load=%dms res=%d bytes=%dk', report.httpStatus, report.loadMs, report.perf.resourceCount, Math.round(report.perf.transferBytesTotal/1024));
console.log('headings=%d imgs=%d buttons=%d contrastFails=%d', report.structure.headingCount, report.structure.imgCount, report.structure.buttonCount, report.contrast.failCount);
await browser.close();
