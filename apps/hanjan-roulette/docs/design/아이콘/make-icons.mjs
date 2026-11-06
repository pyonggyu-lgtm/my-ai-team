// 한잔메뉴룰렛 아이콘 만들기 (진사). 새 패키지 없이 playwright-core + 기존 headless Chromium 사용.
// 실행: LD_LIBRARY_PATH=$(cat /home/claude/chrome-deps/ldpath.txt) FONTCONFIG_FILE=/home/claude/chrome-deps/fonts.conf node docs/design/아이콘/make-icons.mjs  (apps/hanjan-roulette 에서)
// SVG 원본 2개를 이 폴더에 쓰고, client/icons/ 에 PNG 4개를 만든다.
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../../../tests/e2e/_lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../../client/icons");
const C = { navy: "#1B2A44", paper: "#f3eee3", stamp: "#c0392b", line: "#2c4166" };

// 룰렛 6칸 + 위쪽 빨간 표시 삼각형. R = 룰렛 반지름(512 기준). 모든 그림은 가운데 지름 80% 원(반지름 204.8) 안.
function svg({ maskable }) {
  const R = maskable ? 138 : 170, cx = 256, cy = 256;
  const pt = (a, r) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map(v => v.toFixed(2)).join(",");
  let slices = "";
  for (let i = 0; i < 6; i++) {
    const a0 = (i * Math.PI) / 3, a1 = ((i + 1) * Math.PI) / 3;
    slices += `<path d="M${cx},${cy} L${pt(a0, R)} A${R},${R} 0 0 1 ${pt(a1, R)} Z" fill="${i % 2 ? C.stamp : C.paper}"/>`;
  }
  const tipY = cy - R + 26, baseY = cy - R - (maskable ? 30 : 22), hw = maskable ? 26 : 30;
  const bg = maskable ? `<rect width="512" height="512" fill="${C.navy}"/>`
                      : `<rect width="512" height="512" rx="92" fill="${C.navy}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
${bg}
<circle cx="${cx}" cy="${cy}" r="${R + 10}" fill="${C.line}"/>
${slices}
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.paper}" stroke-width="6"/>
<circle cx="${cx}" cy="${cy}" r="${Math.round(R * 0.2)}" fill="${C.navy}" stroke="${C.paper}" stroke-width="6"/>
<path d="M${cx - hw},${baseY} L${cx + hw},${baseY} L${cx},${tipY} Z" fill="${C.stamp}" stroke="${C.paper}" stroke-width="8" stroke-linejoin="round"/>
</svg>
`;
}

const jobs = [
  { name: "아이콘-일반", svg: svg({ maskable: false }), pngs: ["icon-192.png:192", "icon-512.png:512"] },
  { name: "아이콘-마스커블", svg: svg({ maskable: true }), pngs: ["icon-maskable-192.png:192", "icon-maskable-512.png:512"] },
];

const browser = await launch();
try {
  for (const j of jobs) {
    const file = resolve(HERE, j.name + ".svg");
    writeFileSync(file, j.svg);
    const data = "data:image/svg+xml;base64," + Buffer.from(readFileSync(file)).toString("base64");
    for (const spec of j.pngs) {
      const [fname, size] = spec.split(":"); const s = +size;
      const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
      await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${s}px;height:${s}px}</style><img src="${data}">`);
      await page.waitForFunction(() => document.images[0].complete);
      await page.screenshot({ path: resolve(OUT, fname), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
      await page.close();
      console.log("만듦:", fname, s + "x" + s);
    }
  }
} finally { await browser.close(); }
