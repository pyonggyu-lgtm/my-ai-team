// 아주 작은 가짜 document: getElementById 가 id 별로 같은 가짜 요소를 돌려준다(화면 view 시험용).
export function installFakeDom() {
  const els = new Map();
  const make = id => {
    const handlers = {};
    const attrs = {};
    const el = {
      id, value: "", hidden: false, disabled: false, textContent: "", dataset: {}, style: {}, children: [], inert: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: k => attrs[k] ?? null, removeAttribute() {},
      addEventListener(n, fn) { (handlers[n] ??= []).push(fn); },
      removeEventListener() {},
      fire(n, ev = {}) { for (const fn of handlers[n] ?? []) fn({ preventDefault() {}, target: el, ...ev }); },
      focus() { el.focused = true; }, blur() {}, appendChild(c) { el.children.push(c); return c; },
      querySelectorAll: () => [], querySelector: () => null, closest: () => null,
      showModal() { el.open = true; el.shown = (el.shown ?? 0) + 1; }, close() { el.open = false; },
    };
    return el;
  };
  const doc = {
    getElementById: id => els.get(id) ?? els.set(id, make(id)).get(id),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => make(null),
  };
  globalThis.document = doc;
  return { doc, el: id => doc.getElementById(id) };
}
