# Digital Memoir — UI 조사 리포트 v2 (로컬 소스 정본 기준)

- **대상(정본)**: `/workspace/digital-memoir` (Next.js App Router, 실제 소스 코드 정독)
- **조사일**: 2026-07-19 / **담당**: 진삼(코드 정독) + 진록(취합·대비 정량검증)
- **방법**: 소스 파일 전수 정독(app/·components/·store/·services/·types/·utils/, globals.css, tailwind.config.ts). 대비는 실제 토큰값으로 WCAG 계산.
- ⚠️ **v1(`ui-audit-2026-07-19.md`)는 배포 라이브(digital-memoir-chi.vercel.app) 기준이며 로컬 정본과 다름 → 참고자료로만 유지.** 아래는 v1 오판을 정정한 정본 기준 재조사.

---

## 0. v1(라이브) → v2(로컬 정본) 정정 요약

| 항목 | v1(라이브)에서 지적 | 로컬 정본 실제 | 판정 |
|---|---|---|---|
| 배경 | beach.jpg 전면 사진(P0-1) | **사진 없음.** cream(#FAFAF5) + 은은한 종이질감(라디얼 그라디언트+SVG 노이즈), `globals.css:21-33` | **v1 무효** |
| 홈 | `<main>` 0자, 빈 화면(P0-2) | **리치 대시보드**(나이카드·이달현황·다음할일·생일알림·명언), `app/page.tsx` | **v1 무효** |
| h1 | 홈 h1 0개(P1-2) | 전 페이지 `PageHeader`가 `<h1>` 제공(`ui.tsx:19`) | **v1 무효** |
| 팔레트 | primary 블루 #1C7FB8 | gold/sky/coral/cream/ink(#2C2C2C), 블루 없음 | **v1 무효** |
| 레이아웃 | 좌측 쏠림+사진 | `main max-w-5xl mx-auto` 중앙정렬(`layout.tsx:18`) | **v1 무효** |
| 다크모드 | 토글 존재→토큰 필요 | **소스에 다크모드 없음**(darkMode 미설정, `dark:` 0건, 토글 없음) | **v1 전제 무효** |

**→ 로컬 정본의 진짜 문제는 "사진/블루"가 아니라 ⟪대비(Contrast)⟫와 ⟪체계적 접근성⟫이다.** 특히 기본 프로필 생년월일이 **1951-01-01**(`types/common.ts`)로 **고령 사용자 대상** → 저대비·소형 타깃은 치명적.

---

## 1. 앱 구조 (정본)

- **스택**: Next.js App Router + Tailwind + zustand(persist, localStorage). 폰트 Pretendard(jsdelivr)+Lora(Google) `@import`. 아이콘 lucide-react. 차트 recharts(자산만). 날짜 dayjs+ko.
- **레이아웃**(`layout.tsx`): `<html lang="ko">`, 데스크톱 좌측 사이드바(w-64, `bg-cream/60`) + `main max-w-5xl` 중앙. 모바일은 상단바+햄버거 드로어(`Sidebar.tsx`).
- **10개 섹션**: 홈 / 독백 / 사랑하는 사람들에게(편지) / 자산현황 / 관계망 / 추억록 / 타임캡슐 / 라이프 타임라인 / 버킷리스트 / 설정.
- **디자인 토큰**(`tailwind.config.ts`): gold `#D4A574`, gold-dark `#B8894F`, sky `#A8C5DA`, coral `#E8B4A8`, cream `#FAFAF5`, ink `#2C2C2C`, line `#E5DDD0`. radius card 12px. 애니메이션 pop/fadeUp.
- **컴포넌트 프리미티브**(`globals.css` @layer + `ui.tsx`): `.card`(bg-white/80), `.btn-primary`(bg-gold text-white), `.btn-secondary`, `.btn-soft`(sky), `.input`, `.label`, `.chip`(sky/25), `PageHeader`, `Modal`, `EmptyState`, `StatCard`, `Celebration`.

---

## 2. Critical (P0) — 대비(Contrast). 정량 검증 완료

> WCAG 2.1 AA: 일반 텍스트 4.5:1, 큰 텍스트(≥24px 또는 ≥18.66px bold) 3:1. 계산은 실제 토큰값 기준.

### P0-1. 흰 글씨 + gold/sky/coral 배경 = 전면적 AA 미달 ⭐최우선
브랜드 상호작용 요소 대부분이 `text-white`를 밝은 파스텔 배경에 얹음:
- **white on gold `#D4A574` = 2.23:1 (FAIL)** ← `.btn-primary`(`globals.css:43`), 사이드바 활성항목(`Sidebar.tsx:52`), 활성 탭/칩 다수(자산 `:207`, 편지 `:63`, 관계망 `:96,102,116,476`, 추억 `:62`, 버킷 `:119,247`).
- white on gold-dark `#B8894F` = 3.12:1 (FAIL)
- white on sky `#A8C5DA` = 1.80:1 (FAIL), white on coral `#E8B4A8` = 1.82:1 (FAIL)
- **해결 방향(검증)**: **ink(`#2C2C2C`) on gold = 6.27:1 (PASS)** → 밝은 배경 버튼/칩은 **흰 글씨→잉크 글씨**로. 또는 배경을 gold-dark보다 더 어둡게.
- 영향: 앱의 **주 액션(저장/추가/활성 상태)**이 저시력·고령 사용자에게 안 읽힘. **불만 1순위 후보.**

### P0-2. 반투명 잉크 텍스트(`text-ink/40~60`) = AA 미달, 광범위
cream 배경 위 `#2C2C2C` 불투명도 텍스트 실측:
- **text-ink/40 = 2.28:1 (FAIL)** — 검색 아이콘, 아이콘버튼 기본색, 사진추가 라벨, "불러오는 중"(`ClientOnly:11`), 설정 하단 인용(`settings:121`).
- **text-ink/50 = 2.94:1 (FAIL)** — 서브라벨/힌트/메타 **전 페이지 광범위**(`ui.tsx:73,95` EmptyState hint·StatCard sub, `page.tsx:162,187`, Sidebar 부제 `:41`, 그 외 수십 곳).
- **text-ink/60 = 3.89:1 (FAIL)** — `PageHeader` **모든 부제 기본값**(`ui.tsx:22`), 각종 설명문.
- text-ink/70 = 5.18:1 (PASS), /80 = 7.13:1 (PASS).
- **해결 방향**: 본문/보조 텍스트 최소 **ink/70 이상**, 힌트도 /60 금지→/70. 또는 별도 "muted" 토큰을 대비 통과값으로 재정의.

### P0-3. 동적 시대색 위 흰 글씨(추억록)
`memories/page.tsx:70,122` `text-white` + `style={{backgroundColor: era.color}}` — era 색상에 밝은 톤(gold 계열 등) 포함 → 대비 미보장. 색상 대비 자동보정 또는 잉크 텍스트 필요.

---

## 3. High (P1) — 체계적 접근성

### P1-1. 아이콘 온리 버튼에 aria-label 없음 (수정/삭제가 스크린리더 무의미)
Pencil/Trash2 등 텍스트 없는 버튼 다수: 자산 `:247,250`, 버킷 `:173,176`, 편지 `:87,125,131`, 라이프 `:159,162`, 추억 `:149,152,312`, 관계망 `:188,191,245,248`, 타임캡슐 `:99,169`.
- **모범 사례(복제 대상)**: 독백 `monologue:96,103`(`aria-label="수정/삭제"`), `ui.tsx:57`, `Sidebar:67` — 이미 라벨 있음. 이 패턴을 전 버튼에 확산하면 됨.

### P1-2. 폼 label–input 미연결 (시스템적)
`.label`이 전부 `htmlFor` 없이, input에 `id` 없이 쓰임 → 라벨 클릭·스크린리더 연결 불가. 전 모달/폼 공통(설정 `:35,39,43,47`, 관계망 `:362~393`, 자산·편지·추억·버킷·타임캡슐 모달 동일).

### P1-3. Modal 접근성 결함 (공유 컴포넌트 → 전 앱 전파)
`ui.tsx:29-66`: `role="dialog"`·`aria-modal`·`aria-labelledby` 없음, **포커스 트랩 없음, 열림 시 포커스 이동 없음, ESC 닫기 없음**(백드롭 클릭만), 배경 스크롤 잠금 없음.

### P1-4. 탭 타깃 44px 미만 (고령 사용자 오터치)
아이콘버튼 `p-1`(~22px)·`p-1.5`(~28px), 사진삭제 `px-1.5 text-xs`(초소형), 인라인 `text-xs underline` 버튼(편지 `:275`, 독백 `:196`, 버킷 `:161`), 라이프 진행바 마커(이모지 1글자 폭 `:62`). `.btn`은 `py-2 text-sm`≈36px로 44px 미달.

### P1-5. 네이티브 `prompt/confirm/alert` 남용
추억 `:80,82`, 버킷 `:164`, 관계망 `:124,239`, 삭제확인·검증 alert 다수 → 모바일/스크린리더/키보드 UX 취약, 스타일 불가, 브랜드 이탈.

---

## 4. Medium (P2)

### P2-1. 외부 폰트 `@import` (렌더 블로킹)
`globals.css:1-2` Pretendard(jsdelivr)+Lora(Google) CSS `@import` → 렌더 블로킹·FOUT·프라이버시. `next/font`(self-host/최적화) 권장.

### P2-2. 이미지·저장 한계
전 이미지 `<img>`(next/image 미사용). 추억 사진을 canvas 리사이즈(max 900px, jpeg 0.8) 후 **dataURL로 localStorage 저장**(`memories:250-270`) → 사진 다수/고해상도 시 localStorage ~5MB 쿼터 초과 위험(저장 실패·데이터 유실 가능).

### P2-3. 콘텐츠 이미지 alt 빈값
추억 상세/편집 사진 `memories:204,311` `alt=""` — 콘텐츠성 사진엔 의미 있는 alt 권장.

### P2-4. 자체 마크다운 파서 + dangerouslySetInnerHTML
`Markdown.tsx` 정규식 파서. `escapeHtml` 선처리로 기본 XSS는 방어되나 정규식 한계(엣지케이스) 존재. 독백·편지·추억·타임캡슐 본문에 사용.

### P2-5. 홈 대시보드 확장 여지(개선 기회)
`page.tsx`가 이미 5개 스토어 교차집계 중. **자산(총자산)·추억(이달 추억 수)·라이프(다가오는 이정표)** 미포함 → 카드 추가로 대시보드 완성도↑ 가능(데이터모델상 즉시 실현 가능).

---

## 5. 양호 — 유지 권장
- **홈 대시보드**가 이미 다중 스토어 교차집계로 잘 구성됨(나이/이달현황/다음할일/생일알림/명언).
- **컴포넌트 체계**(PageHeader h1, EmptyState, StatCard, .card/.btn/.chip) 일관.
- **종이질감 배경**은 은은하고 감성에 부합(라이브의 사진 지배와 정반대로 절제됨).
- **데이터 주권**: 전부 로컬 zustand+persist, JSON 전체 백업/복원 + 자산·연락처 CSV(BOM) 내보내기.
- 독백 페이지의 aria-label 적용은 **전 앱 확산의 레퍼런스**.
- 반응형(모바일 드로어/데스크톱 사이드바) 구조 정상.

---

## 6. 우선순위 요약 (v2 설계 입력)

| # | 이슈 | 심각도 | 근거(정량/코드) | 난이도 |
|---|---|:---:|---|:---:|
| P0-1 | white-on-gold/sky/coral 대비 미달 | ★★★ | 2.23/1.80/1.82:1, ink on gold=6.27 | 낮음(토큰/유틸) |
| P0-2 | ink/40~60 저대비 텍스트 | ★★★ | 2.28/2.94/3.89:1, /70=5.18 | 낮음 |
| P0-3 | 동적 시대색 위 흰글씨 | ★★☆ | 대비 미보장 | 중 |
| P1-1 | 아이콘버튼 aria-label 없음 | ★★☆ | 파일:줄 다수 | 낮음 |
| P1-2 | 폼 label-input 미연결 | ★★☆ | 전 폼 공통 | 낮음~중 |
| P1-3 | Modal 포커스트랩/ESC/role 없음 | ★★☆ | ui.tsx:29-66 | 중 |
| P1-4 | 탭 타깃 <44px | ★★☆ | p-1/p-1.5/text-xs | 낮음 |
| P1-5 | prompt/confirm/alert 남용 | ★☆☆ | 파일:줄 다수 | 중 |
| P2-* | 폰트/이미지/localStorage/마크다운/대시보드 | ★☆☆ | §4 | 중~높음 |

**설계자(진사)에게**: 이 앱의 UI 개선은 "사진 처리"가 아니라 **① 대비 토큰 재정의(gold 위 잉크텍스트 + muted 토큰 통과값) ② 접근성 프리미티브 보강(aria-label/label연결/Modal/44px)** 두 축이 핵심. 감성 톤(gold/cream/종이질감)은 **유지**하되 대비만 끌어올리는 방향으로 재매핑할 것.
