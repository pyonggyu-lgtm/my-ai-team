// 템플릿·제한값 상수. 서버도 같이 씀.

export const MAX_ITEMS = 16;
export const MAX_ITEM_NAME = 20;
export const MAX_BOARDS = 10;
export const MAX_BOARD_NAME = 12;
export const MAX_RESULT_LEAD = 20;

export const TEMPLATES = {
  empty: { id: "empty", name: "새 메뉴판", resultLead: "오늘의 선택은", items: [] },
  lunch: {
    id: "lunch", name: "점심", resultLead: "오늘 점심은",
    items: ["김치찌개", "제육볶음", "돈가스", "짜장면", "국밥", "비빔밥", "햄버거", "샐러드"],
  },
  drinks: {
    id: "drinks", name: "술 한잔", resultLead: "오늘 먹으러 갈 곳은",
    items: ["고깃집", "치킨집", "횟집", "곱창집", "족발·보쌈", "전집", "이자카야", "호프집"],
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);
