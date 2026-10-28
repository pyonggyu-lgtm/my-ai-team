import { chromium } from 'playwright-core';
import fs from 'fs';
const EXE = '/home/claude/agents/minjun/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const BASE = 'https://digital-memoir-chi.vercel.app';
const OUT = '/workspace/docs/research/_assets';
const ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'];
const pages = ['/monologue', '/life-timeline', '/network', '/settings', '/bucket-list'];
const out = {};
for (const p of pages) {
  const slug = p.replace(/\//g, '');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: EXE, args: ARGS });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(BASE + p, { waitUntil: 'commit', timeout: 30000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/page-${slug}.png` });
    out[p] = await page.evaluate(() => {
      const main = document.querySelector('main');
      const txt = el => (el?.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        mainChars: txt(main).length,
        sample: txt(main).slice(0, 500),
        headings: [...document.querySelectorAll('h1,h2,h3')].map(h => h.tagName + ':' + h.textContent.trim().slice(0, 40)),
      };
    });
    console.log(p, '-> chars=%d headings=%d', out[p].mainChars, out[p].headings.length);
  } catch (e) { out[p] = { error: String(e).slice(0, 100) }; console.log(p, '-> ERR', out[p].error); }
  finally { if (browser) await browser.close(); }
}
fs.writeFileSync(`${OUT}/pages.json`, JSON.stringify(out, null, 2));
console.log('DONE');
