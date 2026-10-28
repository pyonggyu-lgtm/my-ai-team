import { chromium } from 'playwright-core';
import fs from 'fs';
const EXE = '/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = 'https://digital-memoir-chi.vercel.app';
const OUT = '/workspace/docs/research/_assets';
const pages = ['/', '/monologue', '/life-timeline', '/network', '/settings'];
const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const out = {};
for (const p of pages) {
  const url = BASE + p;
  const slug = p === '/' ? 'home' : p.replace(/\//g, '');
  try {
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(3500); // allow client render
  await page.screenshot({ path: `${OUT}/page-${slug}.png`, fullPage: false });
  out[p] = await page.evaluate(() => {
    const main = document.querySelector('main');
    const txt = el => (el?.innerText || '').replace(/\s+/g, ' ').trim();
    const mainText = txt(main);
    // sidebar label visibility: check first nav link computed color vs its bg
    const navLink = document.querySelector('aside nav a');
    let navInfo = null;
    if (navLink) { const s = getComputedStyle(navLink); const sp = navLink.querySelector('span') || navLink.lastChild;
      navInfo = { color: s.color, fontSize: s.fontSize, text: navLink.textContent.trim() }; }
    const headings = [...document.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+':'+h.textContent.trim().slice(0,40));
    return {
      mainExists: !!main,
      mainCharCount: mainText.length,
      mainTextSample: mainText.slice(0, 400),
      mainBoundingEmpty: main ? (main.getBoundingClientRect().height < 50) : null,
      headings,
      navFirst: navInfo,
      bodyChildDivs: document.querySelectorAll('body > div').length,
    };
  });
  console.log(p, '-> mainChars=%d headings=%d', out[p].mainCharCount, out[p].headings.length);
  } catch (e) { out[p] = { error: String(e).slice(0,120) }; console.log(p, '-> ERROR', out[p].error); }
}
fs.writeFileSync(`${OUT}/pages.json`, JSON.stringify(out, null, 2));
await browser.close();
console.log('DONE');
