# Sprint 1 구현 명세서 (진오 적용용)

- **작성일**: 2026-07-19 / **작성**: 진록 / **적용자**: 진오(코드) · 진사(styles/토큰 협업)
- **근거**: `docs/design/ui-improvement-2026-07-19.md`, `docs/design/ui-review-2026-07-19.md`
- **상태**: ⚠️ digital-memoir 소스가 현 워크스페이스에 부재 → **소스 확보 즉시 적용 가능한 패치 명세**로 선작성.
- **범위(승인 확정)**: A-1 / A-2 / B-1 / D-1 / E(대비·타깃·포커스) / E(시맨틱) / F(파비콘). **제외**: 홈 대시보드 데이터피드·바텀시트(S2), 이미지 재인코딩·컬러확장(S3).

---

## 0. 진오 필독 — 주의사항 3건 (팀장 지시)
1. **beach.jpg는 CSS `background-image`다 → `next/image` 적용 불가.** Sprint 1은 배경 **구조 미변경**, CSS 오버레이(B-1)만 얹는다. 경량화(WebP/AVIF)는 S3에서 방식 결정 후.
2. **토큰은 라이트/다크 쌍으로 한 번에 정의**한다. 다크모드 토글 실재(`localStorage 'dm:theme'`). 오버레이 그라디언트도 **하드코딩 금지, 토큰 경유.**
3. **전역 `p{}`가 Lora/700/blue로 박혀 있다.** Pretendard로 되돌리면 의도적 Lora(회고/인용)까지 바뀐다 → **인용용 클래스 분리** 후 시각 위계 회귀 확인. primary `#176699` 반영 후 텍스트/버튼/링크 대비를 **직접 재측정해 AA 확정**(방법: §7).

---

## 1. 관찰로 확정된 사실 (소스 확인 기준점)
> 배포본 SSR/computed-style에서 추출. 실제 파일 경로는 repo에서 대조 확인.

- 스택: **Next.js App Router + Tailwind**, `<html lang="ko">`, 다크모드 `class` 전략(`document.documentElement.classList.add('dark')`).
- 폰트: 본문 `Pretendard, Lora, system-ui`, 세리프 `Lora, Pretendard, Georgia`.
- 색상(실측→hex): primary `#1C7FB8`, ink `#0C2D48`, surface `#F8FCFE`, 카드 `rgba(248,252,254,0.6)`, 활성 nav `bg-primary/15`.
- 배경: `.app-bg` = `position:fixed; z-index:-1; opacity:1; background:url(/beach.jpg); filter:none`.
- 전역 `p` computed: `font-family:Lora; font-weight:700; font-size:18px; color:#1C7FB8` ← **비정상, A-2 대상**.
- 라우트(→ 예상 파일): `/`→`app/page.tsx`, `/monologue`,`/letters`,`/assets`,`/network`,`/memories`,`/time-capsule`,`/life-timeline`,`/bucket-list`,`/settings` 각 `app/<route>/page.tsx`. 레이아웃 `app/layout.tsx`(사이드바+하단탭). 전역 CSS `app/globals.css`. 토큰 `tailwind.config.{js,ts}`.
- **대비 정량 검증**: `#1C7FB8` on white = **4.4:1 (AA FAIL)**, `#176699` on white = **6.18:1 (PASS)**, ink `#0C2D48` = 14.15:1.
- 파비콘: `/favicon.ico|svg`, `/icon.png`, `/apple-touch-icon.png` **전부 404**.

---

## 2. [A-1] 컬러 토큰 (라이트+다크 쌍) — `tailwind.config` + `globals.css`

### 2-1. `app/globals.css` — CSS 변수(라이트/다크 쌍)
`@tailwind base;` 뒤(또는 `@layer base`)에 추가:
```css
:root{
  --ink:#0C2D48; --ink-70:#48627A; --ink-50:#7A8C9C;
  --primary:#176699;        /* 4.4→6.18:1, AA 확보 */
  --primary-strong:#0F4E78;
  --surface:#FFFFFF;        /* 카드 불투명 */
  --surface-sub:#F1F5F8;
  --line:#E2E8F0;
  --success:#2E8B57; --warning:#C9781A; --danger:#C0392B;
  /* B-1 오버레이(라이트) — 하드코딩 금지, 여기서만 정의 */
  --bg-overlay-top:rgba(248,252,254,.86);
  --bg-overlay-bottom:rgba(248,252,254,.96);
}
.dark{
  --ink:#E7EEF5; --ink-70:#AEBECD; --ink-50:#7E90A2;
  --primary:#4BA3D6;        /* 어두운 배경에서 AA 확보용 밝은 톤 */
  --primary-strong:#7FC0E6;
  --surface:#12212E;
  --surface-sub:#0C1922;
  --line:#25384A;
  --success:#4CB07A; --warning:#E0A250; --danger:#E06B5E;
  --bg-overlay-top:rgba(9,17,24,.82);
  --bg-overlay-bottom:rgba(9,17,24,.94);
}
```

### 2-2. `tailwind.config.{js,ts}` — 토큰을 Tailwind 컬러로 노출
```js
module.exports = {
  darkMode: 'class',
  theme: { extend: { colors: {
    ink:      { DEFAULT:'var(--ink)', 70:'var(--ink-70)', 50:'var(--ink-50)' },
    primary:  { DEFAULT:'var(--primary)', strong:'var(--primary-strong)' },
    surface:  { DEFAULT:'var(--surface)', sub:'var(--surface-sub)' },
    line:     'var(--line)',
    success:'var(--success)', warning:'var(--warning)', danger:'var(--danger)',
  } } },
}
```
> **주의**: 기존이 `text-ink/70` 처럼 **불투명도 슬래시**를 쓰고 있었다면, 위 `ink.70` 스케일로 치환(`text-ink-70`)하거나 `text-ink/70` 유지 시 base 컬러만 교체. 프로젝트 기존 표기법에 맞춰 일관 적용. (반투명 `/70`은 사진 위 대비 요동의 원인이므로 **불투명 스케일 권장**.)

---

## 3. [A-2] 본문 타이포 정상화 — `app/globals.css`

### Before (실측)
```css
/* 전역에 p가 세리프/굵게/파랑으로 지정되어 있음 */
p{ font-family:'Lora',...; font-weight:700; font-size:18px; color:#1C7FB8; }
```
### After
```css
p{ font-family:'Pretendard',system-ui,sans-serif; font-weight:400;
   font-size:16px; line-height:1.7; color:var(--ink); }
/* 회고·인용 등 의도적 세리프는 클래스로 격리 */
.prose-serif, .quote{
  font-family:'Lora','Pretendard',Georgia,serif; font-weight:500;
  color:var(--ink); line-height:1.8;
}
```
> **회귀 확인 필수**: 기존에 `p`의 Lora/blue에 의존하던 감성 문구가 있으면 해당 요소에 `class="prose-serif"`(또는 `quote`) 부여 후 시각 위계 확인. (주의사항 3)

---

## 4. [B-1] 배경 무드화 — `app/globals.css` (구조 미변경, 오버레이만)

### Before
```css
.app-bg{ position:fixed; inset:0; z-index:-1; opacity:1;
  background:url(/beach.jpg) center/cover no-repeat; }
```
### After
```css
.app-bg{ position:fixed; inset:0; z-index:-1;
  background:url(/beach.jpg) center/cover no-repeat;
  filter:saturate(.9); }
.app-bg::after{ content:""; position:absolute; inset:0;
  background:linear-gradient(180deg, var(--bg-overlay-top), var(--bg-overlay-bottom)); }
```
- **콘텐츠 컨테이너 불투명화**: 각 페이지 콘텐츠 래퍼(예: `<main>` 또는 그 안 컨테이너)에 `bg-surface` 부여해 사진과 분리. 사진은 카드 바깥 여백에서만 은은히 비침.
- ✅ `next/image` 미사용 — CSS만. 롤백 용이. **beach.jpg 파일/로딩 구조는 손대지 않음.**

---

## 5. [D-1] 카드 불투명화 — 카드 컴포넌트/유틸

### Before
카드 배경 `rgba(248,252,254,0.6)` 반투명 → 사진 비침 → 대비 붕괴.
### After
```
/* 카드 공통 클래스(예: .card 또는 컴포넌트) */
bg-surface  border border-line  rounded-2xl  shadow-sm  p-6 md:p-8
```
- 반투명 배경 유틸(`bg-surface/60`, `bg-cream/…` 등) 제거하고 **불투명 `bg-surface`**로. 다크에서도 `--surface`가 어두운 불투명값이라 자동 대응.

---

## 6. [E] 대비·타깃·포커스 + 시맨틱

### 6-1. 대비
- primary를 `#176699`(라이트)/`#4BA3D6`(다크)로 반영(§2). 버튼/링크/아이콘 텍스트 재확인.
- 사진 위 흰 텍스트(홈 히어로 등)는 §4 오버레이+§5 불투명 카드로 대비 확보. 여전히 사진 직접 위에 놓는 텍스트가 있으면 `text-shadow` 대신 **불투명 서피스로 감싸기**.

### 6-2. 인터랙티브 타깃 44px (실측: 사이드바 34px, 모바일탭 38px)
- 사이드바 링크: `py-2` → **`py-2.5` + `min-h-11`(44px)**.
- 모바일 하단탭 항목: 높이 **56px**, 내부 터치영역 `min-h-11 min-w-11`.
- 버튼 공통: `h-11 px-5 rounded-xl`(primary=`bg-primary text-white hover:bg-primary-strong`, secondary=`border border-line bg-surface text-ink`).
- 홈 히어로의 인라인 텍스트링크 "설정"(대비 1:1 + 유일 소형 타깃) → **버튼으로 승격**(문구: "이름·생년월일 입력하기", `href="/settings"`).

### 6-3. 전역 focus-visible — `globals.css`
```css
:where(a,button,[role=button],input,select,textarea):focus-visible{
  outline:2px solid var(--primary); outline-offset:2px; border-radius:6px;
}
```

### 6-4. 시맨틱 (`app/layout.tsx` + 각 `page.tsx`)
- **페이지별 `<h1>` 보장**: 현재 홈 h1 0개. 각 페이지 제목을 `<h1>`로(내부 페이지는 이미 제목 있으니 태그만 h1 확인). 홈은 인사/타이틀을 `<h1>`로 신설.
- 랜드마크 라벨:
  ```html
  <nav aria-label="주요 메뉴"> ...사이드바... </nav>
  <nav aria-label="하단 탐색"> ...모바일탭... </nav>  <!-- nav 2개 구분 -->
  ```
- 활성 링크에 `aria-current="page"` 부여(활성 스타일과 함께).

---

## 7. [F] 파비콘 세트 (404 제거) — `app/`

Next.js App Router 규칙 파일로 추가(코드 변경 최소):
- `app/icon.svg` (또는 `app/favicon.ico`) — 브랜드 심볼.
- `app/apple-icon.png` (180×180).
- (권장) `app/icon.png` 192·512 → Next가 자동 링크. `manifest.json`/PWA는 **범위 외(후순위)**.
- 검증: 배포 후 `/favicon.ico` 등 404 소멸 + 콘솔 404 사라짐.

---

## 8. 진오 검증 절차 (완료 정의, DoD)
1. **대비 재측정(AA)**: 아래 스니펫으로 주요 텍스트/버튼/링크 실측 후 전부 ≥4.5(큰텍스트≥3). (조사 샘플이 4개로 협소했으니 필수)
   ```js
   // 페이지 콘솔에서 실행: 텍스트 노드 대비 스캔 (fg vs 상위 불투명 bg)
   // (docs/research/scripts/audit.mjs 의 contrast 로직 재사용 가능)
   ```
   > 참고: 팀 리포 `scripts/audit.mjs`에 대비/탭타깃/헤딩 측정 로직 있음. 대상 URL만 바꿔 재실행하면 회귀 자동 점검 가능.
2. **탭타깃**: 사이드바/버튼/모바일탭 ≥44px (audit 스크립트 smallTargets=0 목표).
3. **시맨틱**: 각 페이지 `<h1>` 정확히 1개, `<nav>` 2개 각각 aria-label, 활성 링크 aria-current.
4. **다크모드**: 토글 후 카드/텍스트/오버레이 대비 재확인(라이트와 동일 기준).
5. **회귀**: 전역 `p` 변경으로 의도적 Lora 문구가 깨지지 않았는지 육안 확인.
6. **파비콘**: 404 0건.
7. **반응형**: 1440/768/375 가로 오버플로 0 유지.

---

## 9. 파일 락 가이드 (충돌 방지)
S1은 CSS/토큰 다수 → **진오·진사 영역 경계 주의**.
| 파일 | 소유 | 락 키 |
|---|---|---|
| `app/globals.css`, `tailwind.config.*` | styles=진사 | `lock:file:app/globals.css` 등 |
| `app/layout.tsx`, `app/**/page.tsx` | 진오(src) | `lock:file:app/layout.tsx` 등 |
| `app/icon.*`, `app/apple-icon.*` | 진오 | 해당 경로 락 |
- 수정 전 `SET lock:file:{경로} {이름} EX 3600 NX`. 실패 시 대기. 토큰(styles)은 **진사 선작업 → 진오 컴포넌트 반영** 순서 권장(계약=토큰 먼저).

---

## 10. 착수 조건 (Blocker 해제 필요)
이 명세는 소스 확보 시 적용 가능. **필요**: (a) digital-memoir repo 클론 URL+접근권한, 또는 (b) 로컬 경로. 확보 즉시 §2→§10 순서로 진오 착수, 완료 후 **진육 재리뷰**(§8 DoD 기준) → 진서 최종 승인 → 배포.
