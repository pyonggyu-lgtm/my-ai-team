# Digital Memoir — UI 개선안 v2 (로컬 정본 기준, Before → After)

- **작성일**: 2026-07-19 / **담당**: 진록(진사 영역 대행)
- **정본**: `/workspace/digital-memoir` / **입력**: `docs/research/ui-audit-v2-local-2026-07-19.md`
- **원칙**: 감성 톤(**gold/cream/종이질감 유지**). 블루/사진 도입 없음. **대비만 끌어올리고 접근성 프리미티브를 보강**한다. 고령 사용자(기본 생년 1951) 기준 AA 필수. v1(라이브)의 beach 오버레이·블루 토큰·다크모드 항목은 **정본에 없으므로 폐기**.
- **대비값 전부 실제 토큰으로 계산·검증 완료.**

---

## A. 컬러 토큰 재정의 — 감성 유지 + AA 통과 (`tailwind.config.ts` + `globals.css`)

### 문제(실측)
`white on gold #D4A574 = 2.23:1`, `on sky =1.80`, `on coral =1.82` (전부 FAIL). `gold-dark 링크 on cream = 2.98` FAIL. `text-ink/50=2.94, /60=3.89` FAIL.

### After — 토큰 추가(기존 색은 "배경/장식용"으로 유지, "상호작용/텍스트용" 대비 통과값 신설)
`tailwind.config.ts` colors에 **추가**(기존 gold/sky/coral/cream/ink/line 유지):
```ts
colors: {
  gold:"#D4A574", "gold-dark":"#B8894F", sky:"#A8C5DA", coral:"#E8B4A8",
  cream:"#FAFAF5", ink:"#2C2C2C", line:"#E5DDD0",
  // ▼ v2 추가: 대비 통과용
  "gold-deep":"#8A5E2B",   // 버튼/활성 배경(white 텍스트 5.65:1 PASS)
  "gold-link":"#8A5E2B",   // cream 위 링크(5.4:1 PASS) — 필요시 gold-deep 재사용
  muted:"#5A5A5A",         // 보조 텍스트(cream 위 6.59:1 PASS) — ink/50·60 대체
}
```
> gold-link과 gold-deep은 동일값이라 하나(`gold-deep`)로 통일 가능. 밝은 gold(#D4A574)는 **큰 면적 배경/그라디언트/장식**에만 계속 사용.

---

## B. 상호작용 요소 대비 수정 (`globals.css` @layer + 컴포넌트)

### B-1. 버튼 — `globals.css:42-50`
```diff
- .btn-primary { @apply btn bg-gold text-white hover:bg-gold-dark; }
+ .btn-primary { @apply btn bg-gold-deep text-white hover:bg-[#73501f]; }   /* white 5.65:1 */
  .btn-secondary { @apply btn border border-line bg-white text-ink hover:bg-cream; }  /* 유지(대비 OK) */
- .btn-soft { @apply btn bg-sky/30 text-ink hover:bg-sky/50; }              /* ink 텍스트라 OK, 유지 */
```
> 밝은 gold 버튼 룩을 꼭 유지하고 싶으면 대안: `bg-gold text-ink`(6.27:1 PASS). 단 CTA 강조는 `gold-deep+white`가 더 명확 → **gold-deep 권장**.

### B-2. 사이드바 활성 항목 — `Sidebar.tsx:52`
```diff
- active ? "bg-gold text-white shadow-sm"
+ active ? "bg-gold-deep text-white shadow-sm"
```

### B-3. 활성 탭/칩 (밝은 파스텔 배경은 흰글씨 금지 → 잉크글씨)
`bg-gold text-white`/`bg-sky text-white`/`bg-coral text-white` 형태의 **활성 탭·칩·체크버튼**은 `text-white`→`text-ink`로:
- 자산 `:207`, 편지 `:63`, 관계망 `:96,102,116,476`, 추억 `:62`, 버킷 `:119,247`.
- 규칙: **어두운 배경(gold-deep 등)=white / 밝은 파스텔(gold·sky·coral)=ink**. ⚠️ **[Phase3 정정] 활성/비활성 모두 ink면 상태 구분이 배경 톤차에만 의존 → 저시력 취약. 활성=`font-bold`+`ring-1`(gold-deep) 병행**(특히 추억 era칩 `${color}40`↔full color).

### B-4. 링크 — `text-gold-dark underline` → `text-gold-deep`
홈/설정/대시보드 인라인 링크(`page.tsx:102,164`, `settings:` 등)의 `text-gold-dark`(2.98 FAIL) → `text-gold-deep`(5.4 PASS).

### B-5. 동적 시대색 위 텍스트 (추억 `:70,122`)
`text-white` 고정 대신 **배경 밝기에 따라 ink/white 자동 선택**(유틸: 상대휘도로 임계 판정) 또는 시대색을 항상 어둡게 정규화.

---

## C. 저대비 텍스트 정리 (`text-ink/40~60` → 통과값)

| Before | After | 근거 |
|---|---|---|
| `text-ink/60`(부제 기본 `ui.tsx:22`, 설명문) | `text-ink/70`(5.18) 또는 `text-muted`(6.59) | 3.89 FAIL→PASS |
| `text-ink/50`(힌트·메타 다수 `ui.tsx:73,95` 등) | `text-muted`(#5A5A5A, 6.59) | 2.94 FAIL→PASS |
| `text-ink/40`(검색아이콘·아이콘버튼 기본·"불러오는 중" `ClientOnly:11`) | 아이콘=`text-ink/70`, 비활성 장식만 예외 | 2.28 FAIL |
- 일괄 치환 후 §H 검증으로 재측정. 순수 장식(비텍스트) 아이콘은 예외 허용하되, **정보 전달 텍스트/아이콘은 예외 없음**.

---

## D. 접근성 프리미티브 보강

### D-1. 아이콘 온리 버튼에 `aria-label` 부여 (독백 패턴 확산)
대상(파일:줄): 자산 `247,250` / 버킷 `173,176` / 편지 `87,125,131` / 라이프 `159,162` / 추억 `149,152,312` / 관계망 `188,191,245,248` / 타임캡슐 `99,169`.
```diff
- <button ...><Pencil size={16}/></button>
+ <button ... aria-label="수정"><Pencil size={16}/></button>
- <button ...><Trash2 size={16}/></button>
+ <button ... aria-label="삭제"><Trash2 size={16}/></button>
```
> 모범: `monologue:96,103` 그대로 복제.

### D-2. 폼 label–input 연결 (`Field` 헬퍼 도입 권장)
`.label`+`.input` 조합에 `id`/`htmlFor` 연결. 반복 제거 위해 헬퍼 컴포넌트 신설(진사·진오 협의):
```tsx
// components/ui.tsx 에 추가
import { useId } from "react";
export function Field({label, children}:{label:string; children:(id:string)=>ReactNode}) {
  const id = useId();
  return (<div><label htmlFor={id} className="label">{label}</label>{children(id)}</div>);
}
// 사용: <Field label="이름">{(id)=><input id={id} className="input" .../>}</Field>
```
또는 최소 변경: 각 input에 `id` + label에 `htmlFor` 수기 부여(설정 `:35~48` 등 전 폼).

### D-3. Modal 접근성 (`components/ui.tsx:29-66`) — 공유 컴포넌트라 1곳 수정으로 전 앱 개선
추가: `role="dialog" aria-modal="true" aria-labelledby`(제목 id는 `useId`로 생성해 `h2 ui.tsx:53`에 부여), **열림 시 포커스 이동 + ESC 닫기 + 배경 스크롤 잠금 + 닫힐 때 트리거로 포커스 복원**. (완전 포커스 트랩=Tab 순환은 시간박스로 분리, 최소구현 우선)
> ⚠️ **[Phase3 정정·크래시방지] `ui.tsx:42`의 `if(!open) return null`이 아래 hooks보다 앞에 있음** → useEffect를 그대로 추가하면 **Rules of Hooks 위반(런타임 에러)**. **early-return을 hooks 뒤로 이동**하거나 effect 내부에 `if(!open) return` 가드를 둘 것.
```tsx
useEffect(()=>{ if(!open) return;
  const prev=document.activeElement as HTMLElement;
  document.body.style.overflow="hidden";
  const onKey=(e:KeyboardEvent)=>{ if(e.key==="Escape") onClose(); };
  document.addEventListener("keydown",onKey);
  return ()=>{ document.removeEventListener("keydown",onKey); document.body.style.overflow=""; prev?.focus(); };
},[open,onClose]);
// 컨테이너에 role="dialog" aria-modal="true" aria-labelledby={titleId}, 첫 포커스 대상 지정, 포커스 트랩(Tab 순환)
```

### D-4. 전역 focus-visible (`globals.css`)
```css
:where(a,button,[role=button],input,select,textarea):focus-visible{
  outline:2px solid var(--gold-deep); outline-offset:2px; border-radius:8px;  /* ⚠️[Phase3] gold 금지 */
}
```
> ⚠️ **[Phase3 정정] 링색은 `--gold`(#D4A574) 금지** — cream 위 2.12:1로 **비텍스트대비(WCAG 1.4.11 3:1) 미달** → 포커스가 안 보임. **`--gold-deep`(#8A5E2B) 또는 ink 사용.** `--gold-deep`을 `globals.css :root`에도 CSS 변수로 등록해야 raw CSS에서 참조 가능. **이 항목은 Sprint 1로 상향.**
> `.input`은 이미 `focus:border-gold`(`globals.css:52`) 있음 — focus-visible 링과 병행.

### D-5. (P1-5, 후순위) `prompt/confirm/alert` → 인앱 Modal/Toast
삭제확인은 공용 `ConfirmModal`, 저장/오류 안내는 `Toast`로 단계적 대체(범위 큼 → Sprint 후반).

---

## E. 탭 타깃 44px (`globals.css` + 아이콘버튼)
```diff
- .btn { @apply inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ...; }
+ .btn { @apply inline-flex items-center justify-center gap-1.5 min-h-11 rounded-lg px-4 py-2 text-sm font-medium ...; }
```
- 아이콘 버튼: `p-1`/`p-1.5` → **`inline-flex items-center justify-center min-h-11 min-w-11`**(아이콘 크기는 유지, 터치영역만 확대). 대상: 버킷 `173,177`, 라이프 `159,163`, 타임캡슐 `99,169`, 독백 `92,99`, 추억 삭제 `312`, 모달 닫기 `ui.tsx:54`, Sidebar 메뉴 `67`.
- 인라인 `text-xs underline` 버튼(편지 `275`, 독백 `196`, 버킷 `161`)은 최소 세로 패딩 확보(`py-2 inline-flex items-center min-h-11`).

---

## F. 성능·견고성 (P2)
- **폰트**: `globals.css:1-2` `@import` 제거 → 최적화. ⚠️ **[Phase3 정정] Pretendard는 Google Fonts에 없음** → **`next/font/local`로 woff2 직접 반입**(+ tailwind fontFamily 이름 연동). Lora는 `next/font/google` 가능. 단순 CSS 스왑 아님 → Sprint 2.
- **이미지**: 추억 dataURL localStorage 저장은 용량 위험 → (a) 저장 전 용량 경고/총량 표시, (b) 장기적으로 IndexedDB 이전 검토(Sprint 후반).
- **마크다운**: `Markdown.tsx` escape 선처리 유지(기본 XSS 방어) + 링크 `rel="noopener noreferrer"` 확인.
- **콘텐츠 alt**: 추억 사진 `alt=""` → 제목 기반 alt(`memories:204,311`).

## G. 다크모드 — 범위 밖(신규 기능)
정본에 다크모드 없음. 도입 시 tailwind `darkMode:"class"` + 전 팔레트 다크쌍 + 토글/영속화 신규 구축 필요 → **별도 기능 과제로 분리**(이번 개선 범위 아님).

---

## H. Before → After 요약 + 검증(DoD)

| 영역 | Before | After | 심각도 |
|---|---|---|:---:|
| 주버튼 | bg-gold+white 2.23:1 | bg-gold-deep+white 5.65:1 | P0 |
| 활성 사이드/탭/칩 | white on 파스텔 FAIL | 어두운배경=white / 파스텔=ink | P0 |
| 링크 | gold-dark 2.98:1 | gold-deep 5.4:1 | P0 |
| 보조텍스트 | ink/40~60 FAIL | ink/70·muted PASS | P0 |
| 아이콘버튼 | aria-label 없음 | 전부 라벨 | P1 |
| 폼 | label 미연결 | id/htmlFor(Field) | P1 |
| 모달 | 트랩/ESC/role 없음 | dialog+트랩+ESC+스크롤잠금 | P1 |
| 타깃 | p-1(~22px) | min 44px | P1 |
| 폰트 | @import 블로킹 | next/font | P2 |

**검증(진육 재리뷰 기준)**: ① 주요 버튼/링크/텍스트 대비 실측 전부 AA(4.5, 큰텍스트 3.0) ② 아이콘버튼 100% aria-label ③ 폼 label 연결 ④ 모달 키보드(ESC·Tab트랩)·SR(role/aria) ⑤ 인터랙티브 ≥44px ⑥ 감성 톤(gold/cream/종이질감) 유지 확인 ⑦ 기능 회귀 없음.

## I. Sprint 로드맵 (진육 리뷰 → 진오 구현)
- **Sprint 1 (즉효·고효과)**: A 토큰 추가 + B 버튼/활성/링크 대비 + C 저대비 텍스트 + D-1 아이콘 aria-label + D-4 focus-visible + E 타깃. → 대비/기본 접근성 대부분 해소.
- **Sprint 2 (구조)**: D-2 폼 label 연결(Field) + D-3 Modal 접근성 + F 폰트(next/font).
- **Sprint 3 (심화)**: D-5 prompt/confirm/alert 대체(ConfirmModal/Toast) + F 이미지 저장(IndexedDB) + B-5 동적색 대비 + P2-5 대시보드 확장.

> 진육 리뷰 요청: (1) 버튼 방향 "gold-deep+white" vs "gold+ink" 택1, (2) Sprint 1 범위 실현가능성, (3) Field 헬퍼 도입 vs 수기 id 부여 중 진오 부담 적은 쪽.
