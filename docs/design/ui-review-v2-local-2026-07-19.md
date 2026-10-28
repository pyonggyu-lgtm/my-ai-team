# Digital Memoir — UI 개선안 v2 리뷰 (Phase 3, 로컬 정본)

- **작성일**: 2026-07-19 / **리뷰어**: 진육(독립·소스 대조) · **취합**: 진록
- **대상**: `docs/design/ui-improvement-v2-local-2026-07-19.md` / **정본**: `/workspace/digital-memoir`
- **판정**: **APPROVE WITH CHANGES** — 인용 정확도·대비 계산·우선순위 신뢰할 만함(v1 오판 정확히 폐기). 단 **구현 스니펫 결함 4건**을 반드시 수정 후 진오 착수.

## 정확성 검증 결과
- 인용한 파일:줄/클래스 표본 **전부 실제 코드와 일치**(`.btn-primary=bg-gold text-white`, Sidebar 활성 `:52`, `text-ink/60`@ui.tsx:22, `text-ink/50`@ui.tsx:73·95, 홈 링크 `text-gold-dark`@page.tsx:102·164, 설정 label htmlFor 無, 아이콘버튼 aria-label 無 등). 오차는 "버튼 여는 줄 vs className 줄" **±1 수준** → 진오는 **줄번호가 아닌 요소(Pencil=수정/Trash2=삭제/X=닫기)로 식별**.
- 대비 수치 **독립 재계산 일치**: white/gold 2.23, ink/gold 6.27, gold-deep/white 5.65, gold-deep/cream ≈5.5, muted/cream 6.57, ink/70 5.16, ink/60 3.88, gold-dark링크/cream 2.97. sky/coral 위 ink = 7.77/7.66(여유 통과). **cream을 배경으로 올바르게 계산한 점 신뢰도 높음.**

## 반드시 반영(설계문서 errata 적용 완료)
1. **[크래시] Modal hooks 순서**: `ui.tsx:42`의 `if(!open) return null`이 hooks보다 앞 → 제안 useEffect를 그대로 추가하면 **Rules of Hooks 위반**. **early-return을 hooks 뒤로 이동**(또는 effect 내부 `if(!open) return` 가드). `aria-labelledby`는 `useId`로 title id 생성해 `h2`(`ui.tsx:53`)에 부여.
2. **[접근성 자기모순] focus-visible 링색**: `var(--gold)`는 cream 위 **2.12:1로 비텍스트대비(WCAG 1.4.11 3:1) 미달** → 포커스가 안 보임. **링색 `#8A5E2B`(gold-deep) 또는 ink로 변경**. gold-deep/muted를 `globals.css :root`에도 CSS 변수로 등록해야 raw CSS 참조 가능. → **이 수정만 Sprint 1로 상향.**
3. **[함정] next/font**: **Pretendard는 Google Fonts에 없음** → `next/font/local`로 woff2 직접 반입 + tailwind fontFamily 이름 연동 리팩터 필요. 단순 CSS 스왑 아님 → **P2/Sprint2 유지**.
4. **[미완 스니펫] 포커스 트랩**: 제안에 Tab 순환 실제 코드 없음(주석뿐) → **최소구현(첫요소 focus+ESC+스크롤잠금+포커스복원)만 Sprint2 확정**, 완전 트랩은 시간박스로 분리.

## 추가 권고(반영)
- **활성 칩 상태 표시**: 활성/비활성 모두 ink 글씨로 바꾸면 상태 구분이 배경 톤차에만 의존 → 저시력 취약. **활성=`font-bold` + `ring-1`(gold-deep) 병행**. 특히 추억 era칩(`${color}40`↔full)에 필요.
- **임의값 토큰화**: `hover:bg-[#73501f]` → `gold-deeper` 토큰으로(일관성).
- **min-h-11**: Tailwind 3.4.7에서 생성됨. 미생성 시 `min-h-[44px]` 폴백.
- **Field 헬퍼(리뷰 요청3)**: date/number/textarea 혼재 폼엔 render-prop이 번거로움 → **각 input `id={useId()}` + `htmlFor` 수기**가 진오 부담 최소. 헬퍼는 안정화 후 선택.
- **버튼 방향(리뷰 요청1)**: **gold-deep+white 채택**(CTA와 파스텔 토글칩 위계 분리). 밝은 gold는 배경/그라디언트/장식으로 존치(나이카드·StatCard 손대지 말 것).

## 우선순위
- **대비(Sprint1)가 폼 label 연결(Sprint2)보다 우선 — 정당.** 고령·저시력에게 "안 읽힘"이 라벨 연결보다 치명적. 현 배치 유지.

## Sprint 재확정 (공수)
- **Sprint 1**: A 토큰(gold-deep/muted, config+`:root`) S / B-1~4 대비(+활성 bold·ring) M / C 저대비텍스트 일괄 M / D-1 아이콘 aria-label M / **D-4 focus-visible(링색=gold-deep)** S / E 44px(min-h-11, 폴백) S.
- **Sprint 2**: D-2 폼 label(수기 useId) M / D-3 Modal(role·aria·ESC·스크롤잠금·복원, **hooks순서 수정**) M / F next/font(Pretendard local) M.
- **Sprint 3**: B-5 동적색 대비 M / D-5 ConfirmModal·Toast L / F IndexedDB L / P2-5 대시보드 확장 M.

## 진오 주의사항 3 (필독)
1. **Modal 수정 시 early-return을 hooks 뒤로.** 안 그러면 런타임 크래시. aria-labelledby=useId(title).
2. **focus-visible 링색 `var(--gold)` 금지 → gold-deep/ink.** gold 링은 cream 위 2.12:1로 안 보임. gold-deep/muted는 `:root`에도 변수 등록.
3. **줄번호 말고 아이콘 종류로 식별**(±1 오차). `min-h-11` 미생성 시 `min-h-[44px]`. 폼 label은 각 input `id={useId()}`+`htmlFor` 수기 권장. **next/font는 Pretendard=local 반입**(구글폰트 아님).
