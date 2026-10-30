// 타이틀 템플릿 (짭컷 자체 디자인). 좌표는 1080p 기준 px, 타이틀 중심이 원점.
// 날짜·시간 자리표시({YYYY} 등)는 넣는 순간 오늘 날짜로 바뀐다.
import type { LayerAnim, Title, TitleLayer } from "../core/titles";

export interface TitleTemplate extends Title {
  id: string;
  name: string;
  category: "인기" | "브이로그" | "여행" | "시간" | "장소" | "휴일";
  duration?: number;
  y?: number; // 세로 위치 (캔버스 비율, 기본 0 = 가운데)
}

// 직접 그린 아이콘 (24×24)
const PIN = "M12 1.8c-4.2 0-7.6 3.3-7.6 7.5 0 5.6 7.6 12.9 7.6 12.9s7.6-7.3 7.6-12.9c0-4.2-3.4-7.5-7.6-7.5zm0 10.4a2.9 2.9 0 1 1 0-5.8 2.9 2.9 0 0 1 0 5.8z";
const PLANE = "M21.5 12c0-.9-.7-1.5-1.6-1.5h-5.2L9.8 2.8H7.6l2.6 7.7H5.4L3.6 8H2l1.1 4L2 16h1.6l1.8-2.5h4.8l-2.6 7.7h2.2l4.9-7.7h5.2c.9 0 1.6-.6 1.6-1.5z";
const SPARKLE = "M12 1.5c.7 5.3 2.9 8 8.5 10.5-5.6 2.5-7.8 5.2-8.5 10.5-.7-5.3-2.9-8-8.5-10.5C9.1 9.5 11.3 6.8 12 1.5z";
const BUBBLE = "M24 8h152a18 18 0 0 1 18 18v42a18 18 0 0 1-18 18H82l-30 20 6-20H24A18 18 0 0 1 6 68V26A18 18 0 0 1 24 8z";

const YELLOW = "#ffd84d";
const CORAL = "#ff5a36";
const OUT: LayerAnim = { at: 0.4, dur: 0.35, offset: { opacity: 0 } };
const BEBAS = { fontFamily: "Bebas Neue", bold: false };
const SCRIPT = { fontFamily: "Pacifico", bold: false };

/** 퇴장이 없는 레이어는 끝에서 함께 사라진다 */
const t = (def: Omit<TitleTemplate, "layers"> & { layers: TitleLayer[] }): TitleTemplate => ({ ...def, layers: def.layers.map((l) => ({ out: OUT, ...l })) });

export const TITLE_TEMPLATES: TitleTemplate[] = [
  // ── 인기 ──
  t({
    id: "cinema-wide",
    name: "시네마 와이드",
    category: "인기",
    duration: 5,
    layers: [
      { id: "lineTop", x: 0, y: -80, shape: { type: "line", w: 900, h: 0, stroke: "#ffffff", strokeWidth: 2 }, in: { at: 0, dur: 0.8, ease: "inOut", offset: { sx: 0 } } },
      { id: "lineBot", x: 0, y: 80, shape: { type: "line", w: 900, h: 0, stroke: "#ffffff", strokeWidth: 2 }, in: { at: 0.1, dur: 0.8, ease: "inOut", offset: { sx: 0 } } },
      { id: "title", x: 0, y: 0, text: { label: "제목", content: "THE JOURNEY BEGINS", style: { ...BEBAS, fontSize: 96, letterSpacing: 26 } }, in: { at: 0.3, dur: 0.6, per: "char", order: "center", stagger: 0.035, offset: { opacity: 0, scale: 1.5 } } },
      { id: "sub", x: 0, y: 125, text: { label: "부제", content: "여정의 시작", style: { weight: 400, fontSize: 32, letterSpacing: 14 } }, in: { at: 1.0, dur: 0.6, offset: { opacity: 0 } } },
    ],
  }),
  t({
    id: "highlighter",
    name: "형광펜",
    category: "인기",
    y: 0.3,
    layers: [
      { id: "hl", x: 0, y: 26, shape: { type: "rect", w: 0, h: 0, fill: CORAL, fit: { layer: "text", padX: 20, padY: -36 } }, in: { at: 0, dur: 0.5, reveal: "wipe-right" } },
      { id: "text", x: 0, y: 0, text: { label: "문구", content: "오늘의 기록", style: { weight: 900, fontSize: 110 } }, in: { at: 0.2, dur: 0.45, offset: { y: 16, opacity: 0 } } },
    ],
  }),
  // ── 브이로그 ──
  t({
    id: "vlog-sticker",
    name: "VLOG 스티커",
    category: "브이로그",
    layers: [
      { id: "vlog", x: 0, y: 0, text: { label: "제목", content: "VLOG", style: { ...BEBAS, fontSize: 240 } }, in: { at: 0, dur: 0.45, ease: "back", per: "char", stagger: 0.06, offset: { y: 80, opacity: 0 } } },
      { id: "script", x: 40, y: 72, rotation: -10, text: { label: "손글씨", content: "my daily", style: { ...SCRIPT, fontSize: 70, color: YELLOW } }, in: { at: 0.5, dur: 0.6, reveal: "wipe-right" } },
      { id: "spark", x: 175, y: -95, shape: { type: "path", w: 50, h: 50, d: SPARKLE, fill: YELLOW }, in: { at: 0.9, dur: 0.4, ease: "back", offset: { scale: 0 } }, loop: { kind: "pulse", period: 1.2, amount: 0.15 } },
    ],
  }),
  t({
    id: "speech-bubble",
    name: "말풍선",
    category: "브이로그",
    layers: [
      { id: "bubble", x: 0, y: 12, shape: { type: "path", w: 0, h: 0, d: BUBBLE, vw: 200, vh: 110, stroke: "#ffffff", strokeWidth: 5, fit: { layer: "text", padX: 56, padY: 44 } }, in: { at: 0, dur: 0.8, ease: "inOut", reveal: "draw" } },
      { id: "text", x: 0, y: 0, text: { label: "문구", content: "Sweet moment", style: { ...SCRIPT, fontSize: 64 } }, in: { at: 0.5, dur: 0.6, reveal: "wipe-right" } },
      { id: "spark", x: 10, y: -55, attach: { layer: "text", side: "right", gap: 50 }, shape: { type: "path", w: 40, h: 40, d: SPARKLE, fill: YELLOW }, in: { at: 1.0, dur: 0.4, ease: "back", offset: { scale: 0 } }, loop: { kind: "pulse", period: 1.4, amount: 0.2 } },
      { id: "dot", x: 0, y: 45, attach: { layer: "text", side: "left", gap: 40 }, shape: { type: "ellipse", w: 14, h: 14, fill: YELLOW }, in: { at: 1.1, dur: 0.35, ease: "back", offset: { scale: 0 } }, loop: { kind: "float", period: 1.6, amount: 6 } },
    ],
  }),
  t({
    id: "daily-routine",
    name: "데일리 루틴",
    category: "브이로그",
    layers: [
      { id: "small", x: -175, y: -118, rotation: -6, text: { label: "손글씨", content: "Daily", style: { ...SCRIPT, fontSize: 60 } }, in: { at: 0, dur: 0.5, reveal: "wipe-right" } },
      { id: "main", x: 0, y: 10, text: { label: "제목", content: "“ROUTINE”", style: { ...BEBAS, fontSize: 170, letterSpacing: 6 } }, in: { at: 0.2, dur: 0.45, ease: "back", per: "char", stagger: 0.05, offset: { y: -70, opacity: 0 } } },
    ],
  }),
  t({
    id: "day-badge",
    name: "데이 배지",
    category: "브이로그",
    layers: [
      { id: "ring", x: 0, y: 0, shape: { type: "ellipse", w: 262, h: 262, stroke: CORAL, strokeWidth: 4 }, in: { at: 0.3, dur: 0.6, ease: "inOut", reveal: "draw" }, loop: { kind: "pulse", period: 1.6, amount: 0.05 } },
      { id: "circle", x: 0, y: 0, shape: { type: "ellipse", w: 220, h: 220, fill: CORAL }, in: { at: 0, dur: 0.5, ease: "back", offset: { scale: 0 } } },
      { id: "day", x: 0, y: -66, text: { label: "윗글", content: "DAY", style: { ...BEBAS, fontSize: 52, letterSpacing: 8 } }, in: { at: 0.35, dur: 0.4, offset: { opacity: 0 } } },
      { id: "num", x: 0, y: 30, text: { label: "숫자", content: "01", style: { ...BEBAS, fontSize: 150 } }, in: { at: 0.4, dur: 0.5, ease: "back", offset: { scale: 0.4, opacity: 0 } } },
    ],
  }),
  // ── 여행 ──
  t({
    id: "arch-title",
    name: "아치 타이틀",
    category: "여행",
    duration: 5,
    layers: [
      { id: "arcTop", x: 0, y: 0, shape: { type: "arc", w: 560, h: 260, a0: 200, a1: 340, stroke: "#ffffff", strokeWidth: 14 }, in: { at: 0.2, dur: 0.6, ease: "inOut", reveal: "draw" } },
      { id: "arcBot", x: 0, y: 0, shape: { type: "arc", w: 560, h: 260, a0: 20, a1: 160, stroke: "#ffffff", strokeWidth: 14 }, in: { at: 0.45, dur: 0.6, ease: "inOut", reveal: "draw" } },
      { id: "year", x: -230, y: -178, text: { label: "연도", content: "{YYYY}", style: { ...BEBAS, fontSize: 34, letterSpacing: 4 } }, in: { at: 0.8, dur: 0.35, ease: "back", offset: { scale: 0.5, opacity: 0 } } },
      { id: "plane", x: 230, y: -178, shape: { type: "path", w: 40, h: 40, d: PLANE, fill: "#ffffff" }, in: { at: 0.85, dur: 0.35, ease: "back", offset: { scale: 0.5, opacity: 0 } } },
      { id: "title", x: 0, y: 4, text: { label: "제목", content: "JEJU", style: { ...BEBAS, fontSize: 210, letterSpacing: 8 } }, in: { at: 0.9, dur: 0.6, offset: { opacity: 0, scale: 1.08 } } },
      { id: "sub", x: 0, y: 190, text: { label: "부제", content: "ISLAND TRIP", style: { ...BEBAS, fontSize: 56, letterSpacing: 22 } }, in: { at: 1.1, dur: 0.3, per: "char", stagger: 0.04, offset: { opacity: 0 } } },
      { id: "line", x: 0, y: 248, text: { label: "문장", content: "Life is a journey, not a destination.", style: { weight: 400, fontSize: 22, color: "#dddddd" } }, in: { at: 0.2, dur: 0.25, per: "char", stagger: 0.012, reveal: "scramble" } },
    ],
  }),
  t({
    id: "route",
    name: "출발 → 도착",
    category: "여행",
    duration: 5,
    layers: [
      { id: "from", x: -270, y: 0, text: { label: "출발 코드", content: "ICN", style: { ...BEBAS, fontSize: 150 } }, in: { at: 0, dur: 0.5, offset: { y: 30, opacity: 0 } } },
      { id: "fromName", x: 0, y: 0, attach: { layer: "from", side: "bottom", gap: 4 }, text: { label: "출발지", content: "SEOUL", style: { weight: 500, fontSize: 28, letterSpacing: 6 } }, in: { at: 0.4, dur: 0.4, offset: { opacity: 0 } } },
      { id: "to", x: 270, y: 0, text: { label: "도착 코드", content: "CJU", style: { ...BEBAS, fontSize: 150 } }, in: { at: 0.2, dur: 0.5, offset: { y: 30, opacity: 0 } } },
      { id: "toName", x: 0, y: 0, attach: { layer: "to", side: "bottom", gap: 4 }, text: { label: "도착지", content: "JEJU", style: { weight: 500, fontSize: 28, letterSpacing: 6 } }, in: { at: 0.6, dur: 0.4, offset: { opacity: 0 } } },
      { id: "dash", x: 0, y: 0, shape: { type: "line", w: 260, h: 0, stroke: "#ffffff", strokeWidth: 4, dash: [10, 12] }, in: { at: 0.3, dur: 0.9, ease: "inOut", reveal: "wipe-right" } },
      { id: "plane", x: 0, y: -46, shape: { type: "path", w: 54, h: 54, d: PLANE, fill: "#ffffff" }, in: { at: 0.3, dur: 1.0, ease: "inOut", offset: { x: -150, opacity: 0 } } },
    ],
  }),
  t({
    id: "travel-vibes",
    name: "트래블 바이브",
    category: "여행",
    layers: [
      { id: "main", x: 0, y: 0, text: { label: "제목", content: "TRAVEL\nVIBES", style: { ...BEBAS, fontSize: 170, italic: true, lineHeight: 0.95, shadowColor: CORAL, shadowX: 8, shadowY: 8 } }, in: { at: 0, dur: 0.5, per: "line", stagger: 0.15, offset: { x: -120, opacity: 0 } } },
      { id: "script", x: 185, y: 172, rotation: -8, text: { label: "손글씨", content: "with you", style: { ...SCRIPT, fontSize: 64, color: YELLOW } }, in: { at: 0.8, dur: 0.6, reveal: "wipe-right" } },
    ],
  }),
  // ── 시간 ──
  t({
    id: "digital-date",
    name: "디지털 날짜",
    category: "시간",
    y: 0.3,
    layers: [
      { id: "time", x: 0, y: -40, text: { label: "시간", content: "{hh}:{mm} {AMPM}", style: { fontFamily: "Consolas", bold: false, fontSize: 64, color: "#f4f4f4" } }, in: { at: 0.1, dur: 0.01, per: "char", stagger: 0.05, reveal: "typewriter" } },
      { id: "date", x: 0, y: 0, attach: { layer: "time", side: "bottom", gap: 2 }, text: { label: "날짜", content: "{MON}.{DD} {YYYY}", style: { fontFamily: "Consolas", bold: false, fontSize: 64, color: "#f4f4f4" } }, in: { at: 0.5, dur: 0.01, per: "char", stagger: 0.05, reveal: "typewriter" } },
      { id: "cursor", x: 0, y: 0, attach: { layer: "date", side: "right", gap: 10 }, shape: { type: "rect", w: 30, h: 56, fill: "#f4f4f4" }, in: { at: 1.1, dur: 0.05, offset: { opacity: 0 } }, loop: { kind: "blink", period: 0.9 } },
    ],
  }),
  t({
    id: "week-clock",
    name: "요일 시계",
    category: "시간",
    layers: [
      { id: "clock", x: 0, y: 20, text: { label: "시각", content: "{HH}:{mm}", style: { ...BEBAS, fontSize: 230 } }, in: { at: 0, dur: 0.5, ease: "back", per: "char", stagger: 0.07, offset: { y: 60, opacity: 0 } } },
      { id: "day", x: -60, y: -10, attach: { layer: "clock", side: "top", gap: -30 }, text: { label: "요일", content: "{Week}.", style: { ...SCRIPT, fontSize: 56 } }, in: { at: 0.3, dur: 0.5, reveal: "wipe-right" } },
      { id: "line", x: 0, y: 0, attach: { layer: "clock", side: "bottom", gap: -6 }, shape: { type: "line", w: 260, h: 0, stroke: "#ffffff", strokeWidth: 5 }, in: { at: 0.5, dur: 0.5, ease: "inOut", offset: { sx: 0 } } },
    ],
  }),
  t({
    id: "circle-date",
    name: "원 날짜",
    category: "시간",
    layers: [
      { id: "ring", x: 0, y: 0, shape: { type: "ellipse", w: 300, h: 300, stroke: "#ffffff", strokeWidth: 5 }, in: { at: 0, dur: 0.9, ease: "inOut", reveal: "draw" } },
      { id: "date", x: 0, y: -12, text: { label: "날짜", content: "{MM}.{DD}", style: { ...BEBAS, fontSize: 130 } }, in: { at: 0.3, dur: 0.5, ease: "back", offset: { scale: 0.6, opacity: 0 } } },
      { id: "sub", x: 0, y: 70, text: { label: "손글씨", content: "in my days", style: { ...SCRIPT, fontSize: 38, color: YELLOW } }, in: { at: 0.6, dur: 0.5, reveal: "wipe-right" } },
    ],
  }),
  t({
    id: "stack-date",
    name: "세로 날짜",
    category: "시간",
    layers: [
      { id: "month", x: 0, y: -100, text: { label: "월", content: "{MM}", style: { ...BEBAS, fontSize: 200 } }, in: { at: 0, dur: 0.5, offset: { y: -60, opacity: 0 } } },
      { id: "bar", x: 0, y: -8, shape: { type: "line", w: 120, h: 0, stroke: "#ffffff", strokeWidth: 6 }, in: { at: 0.3, dur: 0.4, ease: "inOut", offset: { sx: 0 } } },
      { id: "day", x: 0, y: 84, text: { label: "일", content: "{DD}", style: { ...BEBAS, fontSize: 200 } }, in: { at: 0.15, dur: 0.5, offset: { y: 60, opacity: 0 } } },
      { id: "week", x: 0, y: 210, text: { label: "요일", content: "{요일}요일", style: { weight: 400, fontSize: 36, letterSpacing: 6 } }, in: { at: 0.6, dur: 0.5, offset: { opacity: 0 } } },
    ],
  }),
  // ── 장소 ──
  t({
    id: "pin-tag",
    name: "위치 태그",
    category: "장소",
    y: 0.32,
    layers: [
      // 핀이 들어갈 자리만큼 왼쪽을 넓힌다 (왼쪽 여백 80 = 핀 36 + 간격 10 + 34)
      { id: "pill", x: -23, y: 0, shape: { type: "rect", w: 0, h: 0, fill: "#ffffff", radius: 999, fit: { layer: "name", padX: 57, padY: 12 } }, in: { at: 0, dur: 0.45, ease: "back", offset: { sx: 0.2, opacity: 0 } } },
      { id: "pin", x: 0, y: 0, attach: { layer: "name", side: "left", gap: 10 }, shape: { type: "path", w: 36, h: 36, d: PIN, fill: "#111111" }, in: { at: 0.25, dur: 0.45, ease: "back", offset: { y: -40, opacity: 0 } } },
      { id: "name", x: 0, y: 0, text: { label: "장소", content: "서울숲", style: { weight: 800, fontSize: 52, color: "#111111" } }, in: { at: 0.3, dur: 0.45, reveal: "wipe-right" } },
      { id: "sub", x: 0, y: 0, attach: { layer: "name", side: "bottom", gap: 26 }, text: { label: "날짜", content: "{YYYY}.{MM}.{DD}", style: { weight: 500, fontSize: 28, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 8 } }, in: { at: 0.5, dur: 0.4, offset: { y: 12, opacity: 0 } } },
    ],
  }),
  t({
    id: "line-place",
    name: "라인 장소",
    category: "장소",
    layers: [
      { id: "name", x: 0, y: 0, text: { label: "장소", content: "JEJU ISLAND", style: { ...BEBAS, fontSize: 110, letterSpacing: 18 } }, in: { at: 0, dur: 0.5, per: "char", order: "center", stagger: 0.04, offset: { y: 20, opacity: 0 } } },
      { id: "sub", x: 0, y: 0, attach: { layer: "name", side: "bottom", gap: 14 }, text: { label: "부제", content: "제주도", style: { weight: 400, fontSize: 32, letterSpacing: 8 } }, in: { at: 0.7, dur: 0.5, offset: { opacity: 0 } } },
      { id: "lineL", x: 0, y: 0, attach: { layer: "name", side: "left", gap: 30 }, shape: { type: "line", w: 160, h: 0, stroke: "#ffffff", strokeWidth: 3 }, in: { at: 0.2, dur: 0.6, ease: "inOut", offset: { sx: 0 } } },
      { id: "lineR", x: 0, y: 0, attach: { layer: "name", side: "right", gap: 30 }, shape: { type: "line", w: 160, h: 0, stroke: "#ffffff", strokeWidth: 3 }, in: { at: 0.2, dur: 0.6, ease: "inOut", offset: { sx: 0 } } },
    ],
  }),
  // ── 휴일 ──
  t({
    id: "hello-holiday",
    name: "헬로 홀리데이",
    category: "휴일",
    layers: [
      { id: "hello", x: 0, y: -50, text: { label: "인사", content: "HELLO!", style: { ...BEBAS, fontSize: 170, letterSpacing: 10 } }, in: { at: 0.1, dur: 0.01, per: "char", stagger: 0.09, reveal: "typewriter" } },
      { id: "holiday", x: 0, y: 88, rotation: -4, text: { label: "손글씨", content: "Holiday~", style: { ...SCRIPT, fontSize: 90, color: YELLOW } }, in: { at: 0.75, dur: 0.6, reveal: "wipe-left" } },
      { id: "sun", x: 0, y: -40, attach: { layer: "hello", side: "right", gap: 20 }, shape: { type: "ellipse", w: 26, h: 26, fill: "#ff8a3d" }, in: { at: 1.2, dur: 0.35, ease: "back", offset: { scale: 0 } }, loop: { kind: "pulse", period: 1.2, amount: 0.25 } },
    ],
  }),
];

export const TITLE_CATEGORIES = [...new Set(TITLE_TEMPLATES.map((x) => x.category))];
