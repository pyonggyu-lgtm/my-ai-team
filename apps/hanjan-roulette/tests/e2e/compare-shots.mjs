// 정지 화면 캡처(첫 화면 1440×900, 모바일 390×844) 전체 픽셀 비교. checklist.mjs 가 만든 D-*.png 를 읽는다.
import fs from "node:fs";
import { launch, pixelDiff, CAP } from "./_lib.mjs";
const b = await launch(); const out = {};
for (const n of ["01-첫화면", "04-모바일390"]) {
  const u = t => "data:image/png;base64," + fs.readFileSync(`${CAP}/D-${n}-${t}.png`).toString("base64");
  out[n] = await pixelDiff(b, u("orig"), u("new")); console.log(n, JSON.stringify(out[n]));
}
await b.close(); fs.writeFileSync(`${CAP}/shots_result.json`, JSON.stringify(out, null, 2));
