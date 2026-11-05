// 상태·저장·화면·이벤트 연결 — 원본 135–136, 141–199(상태 부분), 311–335, 362–441줄.
import { drawWheel, planSpin, animateSpin } from "./wheel.js";
import { yesterdayName, todayConfirmed, computePool, itemTag } from "./pool.js";
import { setSound, tick, chime, startConfetti, stopConfetti } from "./effects.js";

const DEFAULT_MENU = ["김치찌개","제육볶음","돈가스","짜장면","국밥","비빔밥","햄버거","샐러드"];
const MAX_MENU = 16;
const $ = id => document.getElementById(id);

// ---------- storage (browser-local; every access guarded) ----------
const KEY = "lunchRoulette.v1.";
function load(name, fallback) {
  try { const v = localStorage.getItem(KEY + name); return v === null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function save(name, value) {
  try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch (e) {}
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- state ----------
let items = load("items", null);
if (!Array.isArray(items) || !items.length) items = DEFAULT_MENU.map(n => ({ name: n, on: true }));
let history = load("history", []);           // [{date, name}] confirmed menus
let skipped = load("skipped", { date: "", names: [] });
if (skipped.date !== todayStr()) skipped = { date: todayStr(), names: [] };
let sound = load("sound", false) === true;
setSound(sound);

const cv = $("wheel"), g = cv.getContext("2d");
let wheelNames = [];
let theta = 0, spinning = false;
let pendingName = null, pendingSingle = false;

function saveItems() { save("items", items); }
function saveHistory() { save("history", history); }
function saveSkipped() { save("skipped", skipped); }

// pool.js 는 순수 함수라, 넘김 비우기(원본 195줄)는 여기서 한다.
function compute() {
  const r = computePool({ items, skippedNames: skipped.names, yesterday: yesterdayName(history, todayStr()) });
  if (r.resetSkipped) { skipped.names = []; saveSkipped(); }
  return r;
}

// ---------- spin ----------
function spin() {
  if (spinning || $("overlay").classList.contains("show")) return;
  const comp = compute();
  render();
  if (comp.block) return;
  if (comp.single) { showResult(comp.pool[0], true); return; }

  wheelNames = comp.pool.slice();          // freeze wheel for this spin
  const { k, delta } = planSpin(theta, wheelNames.length);   // winner is decided before the animation
  spinning = true; document.body.classList.add("busy"); $("spin").disabled = true;
  animateSpin({ ctx: g, names: wheelNames, from: theta, delta, onTick: tick }).then(finalTheta => {
    theta = finalTheta;
    spinning = false; document.body.classList.remove("busy");
    showResult(wheelNames[k], false);
  });
}

// ---------- result overlay ----------
function showResult(name, single) {
  pendingName = name; pendingSingle = single;
  $("resultName").textContent = name;
  $("againBtn").style.display = single ? "none" : "";
  $("overlay").classList.add("show");
  chime(); startConfetti($("confetti"));
}
function hideOverlay() { $("overlay").classList.remove("show"); stopConfetti(); render(); }

$("okBtn").onclick = () => {
  const t = todayStr();
  history = history.filter(h => h.date !== t);
  history.push({ date: t, name: pendingName });
  history = history.slice(-30);
  skipped = { date: t, names: [] };
  saveHistory(); saveSkipped();
  hideOverlay();
};
$("againBtn").onclick = () => {
  if (!skipped.names.includes(pendingName)) skipped.names.push(pendingName);
  skipped.date = todayStr(); saveSkipped();
  hideOverlay();
  setTimeout(spin, 350);
};
$("closeBtn").onclick = hideOverlay;

// ---------- menu list ----------
function render() {
  const comp = compute();
  if (!spinning) { wheelNames = comp.pool.slice(); drawWheel(g, wheelNames, theta, 0); }
  $("notice").textContent = comp.msg;
  $("spin").disabled = spinning || !!comp.block;
  const tc = todayConfirmed(history, todayStr());
  $("today").textContent = tc ? "오늘 점심 확정: " + tc : "";
  $("count").textContent = items.length + " / " + MAX_MENU;
  $("snd").textContent = sound ? "소리 켜짐" : "소리 꺼짐";
  $("snd").classList.toggle("on", sound);
  $("snd").setAttribute("aria-pressed", sound);

  const y = yesterdayName(history, todayStr()), list = $("list");
  list.textContent = "";
  items.forEach((it, idx) => {
    const li = document.createElement("li");
    const tag = itemTag(it, { confirmed: tc, skippedNames: skipped.names, yesterday: y });
    li.className = (it.on ? "" : "off") + (tag && tag !== "오늘 확정" ? " excl" : "");
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = it.on;
    cb.onchange = () => { it.on = cb.checked; saveItems(); render(); };
    const nm = document.createElement("span"); nm.className = "name"; nm.textContent = it.name; nm.title = it.name;
    const tg = document.createElement("span"); tg.className = "tag"; tg.textContent = tag;
    const x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "×"; x.title = "지우기";
    x.onclick = () => removeItem(idx);
    li.append(cb, nm, tg, x);
    list.appendChild(li);
  });
}

let toastTimer = 0;
function removeItem(idx) {
  const [gone] = items.splice(idx, 1);
  saveItems(); render();
  const t = $("toast");
  t.textContent = "「" + gone.name + "」를 지웠어요";
  const b = document.createElement("button"); b.textContent = "되돌리기";
  b.onclick = () => { items.splice(idx, 0, gone); saveItems(); t.style.display = "none"; clearTimeout(toastTimer); render(); };
  t.appendChild(b);
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = "none"; }, 5000);
}

$("addForm").onsubmit = e => {
  e.preventDefault();
  const name = $("addInput").value.trim(), msg = $("addMsg");
  if (!name) return;
  if (items.length >= MAX_MENU) { msg.textContent = MAX_MENU + "개까지 넣을 수 있어요."; return; }
  if (items.some(i => i.name === name)) { msg.textContent = "이미 있는 메뉴예요."; return; }
  items.push({ name, on: true }); saveItems();
  $("addInput").value = ""; msg.textContent = "";
  render();
};
$("addInput").oninput = () => { $("addMsg").textContent = ""; };

$("resetBtn").onclick = () => {
  if (!confirm("메뉴를 처음 8개로 되돌릴까요? 지금 목록은 사라져요.")) return;
  items = DEFAULT_MENU.map(n => ({ name: n, on: true }));
  saveItems(); render();
};
$("snd").onclick = () => { sound = !sound; save("sound", sound); setSound(sound); render(); if (sound) tick(); };

// ---------- spin trigger ----------
$("spin").onclick = e => { e.target.blur(); spin(); };
addEventListener("keydown", e => {
  if (e.code !== "Space" || e.target.tagName === "INPUT") return;
  e.preventDefault(); spin();
});
addEventListener("keyup", e => {
  if (e.code === "Space" && e.target.tagName !== "INPUT") e.preventDefault();
});

render();
// canvas text needs the embedded font; redraw once it is ready
if (document.fonts && document.fonts.load) {
  document.fonts.load("700 40px Pretendard").then(() => { if (!spinning) drawWheel(g, wheelNames, theta, 0); });
}
