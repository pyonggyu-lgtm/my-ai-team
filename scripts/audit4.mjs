import { chromium } from 'playwright-core';
import fs from 'fs';
const EXE = '/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = 'https://digital-memoir-chi.vercel.app';
const OUT = '/workspace/docs/research/_assets';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
const browser = await chromium.launch({ executablePath: EXE, args: ARGS });
const out = {};

// 1) definitive nav-label + app-bg analysis on home
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(4000);
  out.nav = await page.evaluate(() => {
    const links = [...document.querySelectorAll('aside nav a')].map(a => {
      const s = getComputedStyle(a); const r = a.getBoundingClientRect();
      // find the text node span (last element or text)
      const label = a.textContent.trim();
      const span = a.querySelector('span');
      const ss = span ? getComputedStyle(span) : s;
      return { label, linkW: Math.round(r.width), color: ss.color, fontSize: ss.fontSize,
        display: ss.display, opacity: ss.opacity, visibility: ss.visibility,
        spanExists: !!span };
    });
    // app-bg element
    const bg = document.querySelector('.app-bg');
    const bs = bg ? getComputedStyle(bg) : null;
    return { links, appBg: bs ? { opacity: bs.opacity, background: bs.backgroundImage.slice(0,80),
      position: bs.position, filter: bs.filter, zIndex: bs.zIndex } : null,
      asideWidth: Math.round(document.querySelector('aside')?.getBoundingClientRect().width || 0) };
  });
  await page.screenshot({ path: `${OUT}/home-final.png` });
  await page.close();
}

// 2) content page /monologue full render
for (const p of ['/monologue', '/settings']) {
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + p, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(5000);
    const slug = p.replace(/\//g,'');
    await page.screenshot({ path: `${OUT}/page-${slug}.png`, fullPage: true });
    out[p] = await page.evaluate(() => {
      const main = document.querySelector('main');
      return { mainChars: (main?.innerText||'').replace(/\s+/g,' ').trim().length,
        sample: (main?.innerText||'').replace(/\s+/g,' ').trim().slice(0,600),
        headings: [...document.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,50)) };
    });
    console.log(p, 'chars=%d', out[p].mainChars);
    await page.close();
  } catch(e){ out[p]={error:String(e).slice(0,100)}; console.log(p,'ERR'); }
}
fs.writeFileSync(`${OUT}/deep.json`, JSON.stringify(out, null, 2));
console.log('NAV LABELS:', JSON.stringify(out.nav?.links?.slice(0,3)));
console.log('APP-BG:', JSON.stringify(out.nav?.appBg), 'aside=', out.nav?.asideWidth);
await browser.close();
