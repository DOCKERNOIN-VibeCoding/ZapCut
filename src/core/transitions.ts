// 메인 트랙 전환 카탈로그. 내보내기는 FFmpeg xfade, 미리보기는 같은 동작의 셰이더(preview/shaders.ts)를 쓴다.
// 동작(방향·곡선)은 실제 xfade 출력을 측정해 맞췄다.

export interface TransitionDef {
  id: string;
  name: string;
  category: string;
  xfade: string;
  kind: number; // 셰이더 번호
}

export const TRANSITIONS: TransitionDef[] = [
  { id: "fade", name: "디졸브", category: "기본", xfade: "fade", kind: 1 },
  { id: "fadeblack", name: "검정 페이드", category: "기본", xfade: "fadeblack", kind: 2 },
  { id: "fadewhite", name: "흰색 페이드", category: "기본", xfade: "fadewhite", kind: 3 },
  { id: "dissolve", name: "모래알", category: "기본", xfade: "dissolve", kind: 4 },
  { id: "pixelize", name: "픽셀", category: "기본", xfade: "pixelize", kind: 5 },
  { id: "hblur", name: "블러 넘김", category: "기본", xfade: "hblur", kind: 6 },
  { id: "zoomin", name: "줌 인", category: "기본", xfade: "zoomin", kind: 7 },
  { id: "wipeleft", name: "와이프 ←", category: "와이프", xfade: "wipeleft", kind: 10 },
  { id: "wiperight", name: "와이프 →", category: "와이프", xfade: "wiperight", kind: 11 },
  { id: "wipeup", name: "와이프 ↑", category: "와이프", xfade: "wipeup", kind: 12 },
  { id: "wipedown", name: "와이프 ↓", category: "와이프", xfade: "wipedown", kind: 13 },
  { id: "smoothleft", name: "부드러운 와이프 ←", category: "와이프", xfade: "smoothleft", kind: 14 },
  { id: "smoothright", name: "부드러운 와이프 →", category: "와이프", xfade: "smoothright", kind: 15 },
  { id: "slideleft", name: "밀어내기 ←", category: "슬라이드", xfade: "slideleft", kind: 20 },
  { id: "slideright", name: "밀어내기 →", category: "슬라이드", xfade: "slideright", kind: 21 },
  { id: "slideup", name: "밀어내기 ↑", category: "슬라이드", xfade: "slideup", kind: 22 },
  { id: "slidedown", name: "밀어내기 ↓", category: "슬라이드", xfade: "slidedown", kind: 23 },
  { id: "coverleft", name: "덮기 ←", category: "슬라이드", xfade: "coverleft", kind: 24 },
  { id: "coverright", name: "덮기 →", category: "슬라이드", xfade: "coverright", kind: 25 },
  { id: "revealleft", name: "걷어내기 ←", category: "슬라이드", xfade: "revealleft", kind: 26 },
  { id: "revealright", name: "걷어내기 →", category: "슬라이드", xfade: "revealright", kind: 27 },
  { id: "circleopen", name: "원형 열기", category: "도형", xfade: "circleopen", kind: 30 },
  { id: "circleclose", name: "원형 닫기", category: "도형", xfade: "circleclose", kind: 31 },
  { id: "radial", name: "시계 방향", category: "도형", xfade: "radial", kind: 32 },
  { id: "horzopen", name: "가로 열기", category: "도형", xfade: "horzopen", kind: 33 },
  { id: "vertopen", name: "세로 열기", category: "도형", xfade: "vertopen", kind: 34 },
];

export const TRANSITION_CATEGORIES = [...new Set(TRANSITIONS.map((t) => t.category))];
export const findTransition = (id?: string) => TRANSITIONS.find((t) => t.id === id);
export const DEFAULT_TRANSITION_DURATION = 0.6;
