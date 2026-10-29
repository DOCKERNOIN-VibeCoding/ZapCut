// 영상 템플릿 = 편집 기능을 묶은 "레시피(매크로)".
// 슬롯에 사용자 미디어를 넣고, 전환·필터·카메라 움직임·텍스트·효과·스티커·효과음·배경음악을 한 번에 적용한다.
import type { AnimRef, CanvasBg, TextStyle } from "../core/types";

export type CameraMove = "none" | "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "alternate";

export interface TemplateText {
  start: number; // 초 (음수면 끝에서부터)
  duration: number;
  content: string;
  style: Partial<TextStyle>;
  y?: number;
  x?: number;
  animIn?: AnimRef;
  animOut?: AnimRef;
  animLoop?: AnimRef;
}

export interface TemplateDef {
  id: string;
  name: string;
  category: "브이로그" | "여행" | "축하" | "비즈니스" | "쇼츠" | "시네마틱" | "레트로" | "감성";
  description: string;
  aspect: "16:9" | "9:16" | "1:1";
  slots: number;
  slotDuration: number; // 슬롯당 길이(초)
  transitions?: string[]; // 슬롯 사이 전환 (순환)
  transitionDuration?: number;
  filter?: { id: string; intensity: number };
  camera?: CameraMove;
  canvas?: CanvasBg;
  texts?: TemplateText[];
  effects?: { id: string; start: number; duration: number; params?: Record<string, number> }[];
  stickers?: { id: string; start: number; duration: number; x: number; y: number; scale: number; loop?: string }[];
  sounds?: { id: string; start: number }[];
  whooshOnCuts?: boolean; // 전환마다 효과음
  bgm?: string;
  accent: string; // 카드 색
}

const A = (id: string, duration = 0.5): AnimRef => ({ id, duration });

export const TEMPLATES: TemplateDef[] = [
  {
    id: "vlog-daily", name: "데일리 브이로그", category: "브이로그", description: "부드러운 디졸브와 손글씨 제목, 잔잔한 로파이 배경음악", accent: "#f4a259",
    aspect: "16:9", slots: 5, slotDuration: 3, transitions: ["fade"], transitionDuration: 0.6, filter: { id: "mood-cafe", intensity: 0.8 }, camera: "alternate",
    texts: [{ start: 0.3, duration: 3, content: "오늘의 브이로그", style: { fontFamily: "Gungsuh", italic: true, bold: false, strokeWidth: 0, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 10, fontSize: 110 }, y: 0, animIn: A("fade", 1), animOut: A("fade", 0.8) }],
    stickers: [{ id: "doodle-sun", start: 0.3, duration: 3, x: 0.33, y: -0.3, scale: 0.18, loop: "spin" }],
    bgm: "bgm-lofi-chill",
  },
  {
    id: "vlog-week", name: "일주일 기록", category: "브이로그", description: "요일 자막과 밀어내기 전환, 경쾌한 플럭 음악", accent: "#7bdff2",
    aspect: "16:9", slots: 7, slotDuration: 2, transitions: ["slideleft"], transitionDuration: 0.4, filter: { id: "season-spring", intensity: 0.7 }, camera: "zoom-in", whooshOnCuts: true,
    texts: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d, i) => ({ start: i * 2 + 0.2, duration: 1.6, content: d, style: { fontFamily: "Segoe UI", bold: true, strokeWidth: 0, background: "rgba(0,0,0,0.45)", bgRadius: 40, fontSize: 64 }, x: -0.35, y: 0.38, animIn: A("slide-right", 0.3) })),
    bgm: "bgm-cute-pluck",
  },
  {
    id: "travel-slideshow", name: "여행 슬라이드쇼", category: "여행", description: "켄 번스 줌과 원형 전환, 비행기 스티커", accent: "#4ea8de",
    aspect: "16:9", slots: 6, slotDuration: 3, transitions: ["circleopen", "fade", "wipeleft"], transitionDuration: 0.8, filter: { id: "land-vivid", intensity: 0.7 }, camera: "alternate",
    texts: [{ start: 0.4, duration: 3.2, content: "TRAVEL DIARY", style: { fontFamily: "Georgia", bold: false, strokeWidth: 0, letterSpacing: 26, fontSize: 120, shadowColor: "rgba(0,0,0,0.5)", shadowBlur: 14 }, y: 0, animIn: A("stretch", 1), animOut: A("fade", 0.8) }],
    stickers: [{ id: "life-airplane", start: 0.6, duration: 2.8, x: -0.32, y: -0.28, scale: 0.18, loop: "float" }, { id: "life-pin", start: 3.2, duration: 2.6, x: 0.35, y: 0.25, scale: 0.15, loop: "bounce" }],
    bgm: "bgm-ambient-dream",
  },
  {
    id: "travel-shorts", name: "여행 쇼츠", category: "쇼츠", description: "세로 화면, 빠른 컷과 줌 펄스, 신나는 하우스", accent: "#06d6a0",
    aspect: "9:16", slots: 8, slotDuration: 1.2, transitions: ["zoomin", "slideup"], transitionDuration: 0.3, filter: { id: "season-summer", intensity: 0.8 }, camera: "zoom-in", canvas: { type: "blur", color: "#000000", blur: 0.6 }, whooshOnCuts: true,
    texts: [{ start: 0.1, duration: 2.2, content: "여름 여행 🌊", style: { fontFamily: "Malgun Gothic", bold: true, color: "#ffffff", strokeColor: "#0077b6", strokeWidth: 10, fontSize: 120 }, y: -0.3, animIn: A("pop", 0.35), animLoop: A("bounce", 0.6) }],
    effects: [{ id: "zoom-pulse", start: 0, duration: 9.6, params: { strength: 0.25, speed: 2 } }],
    bgm: "bgm-house-upbeat",
  },
  {
    id: "birthday", name: "생일 축하", category: "축하", description: "케이크·하트 스티커와 반짝이 글자, 팝 전환", accent: "#ff7eb6",
    aspect: "16:9", slots: 4, slotDuration: 3, transitions: ["circleclose", "fadewhite"], transitionDuration: 0.7, filter: { id: "portrait-peach", intensity: 0.8 }, camera: "zoom-in",
    texts: [{ start: 0.3, duration: 4, content: "HAPPY BIRTHDAY", style: { fontFamily: "Malgun Gothic", bold: true, color: "#ffd86b", color2: "#ff5c8a", strokeColor: "#ffffff", strokeWidth: 8, fontSize: 130 }, y: -0.05, animIn: A("pop", 0.5), animLoop: A("heartbeat", 1) }],
    stickers: [{ id: "life-cake", start: 0.5, duration: 3.6, x: -0.35, y: 0.25, scale: 0.22, loop: "wiggle" }, { id: "heart-double", start: 0.8, duration: 3.4, x: 0.36, y: -0.28, scale: 0.18, loop: "pulse" }, { id: "twinkle", start: 1, duration: 3, x: 0.33, y: 0.3, scale: 0.16, loop: "flicker" }],
    sounds: [{ id: "sparkle", start: 0.3 }],
    bgm: "bgm-cute-pluck",
  },
  {
    id: "congrats", name: "축하합니다", category: "축하", description: "화이트 플래시와 성공 차임, 금빛 자막", accent: "#ffd166",
    aspect: "16:9", slots: 4, slotDuration: 2.5, transitions: ["fadewhite"], transitionDuration: 0.6, filter: { id: "portrait-glow", intensity: 0.8 }, camera: "zoom-out",
    texts: [{ start: 0.2, duration: 3, content: "축하합니다!", style: { bold: true, color: "#ffe9a8", color2: "#f0a500", strokeColor: "#4a2a00", strokeWidth: 8, fontSize: 140 }, y: 0, animIn: A("zoom-out", 0.5), animOut: A("fade", 0.6) }],
    effects: [{ id: "white-flash", start: 0, duration: 1, params: { strength: 0.8, speed: 1 } }],
    stickers: [{ id: "star-badge", start: 0.4, duration: 2.6, x: 0.36, y: -0.28, scale: 0.18, loop: "spin" }],
    sounds: [{ id: "success", start: 0.2 }],
  },
  {
    id: "product-intro", name: "제품 소개", category: "비즈니스", description: "깔끔한 와이프 전환과 라벨 자막, 블록버스터 색감", accent: "#118ab2",
    aspect: "16:9", slots: 4, slotDuration: 3, transitions: ["smoothleft", "coverleft"], transitionDuration: 0.6, filter: { id: "film-epic", intensity: 0.6 }, camera: "pan-left",
    texts: [
      { start: 0.3, duration: 2.7, content: "NEW PRODUCT", style: { fontFamily: "Segoe UI", bold: true, color: "#ffffff", strokeWidth: 0, background: "#118ab2", bgRadius: 8, fontSize: 80, letterSpacing: 8 }, x: -0.25, y: 0.3, animIn: A("slide-right", 0.5) },
      { start: 3.3, duration: 2.7, content: "더 가볍고, 더 강하게", style: { bold: true, strokeWidth: 0, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 12, fontSize: 84 }, y: 0.32, animIn: A("slide-up", 0.5) },
      { start: -2.6, duration: 2.4, content: "지금 만나보세요", style: { bold: true, color: "#111111", strokeWidth: 0, background: "#ffffff", bgRadius: 40, fontSize: 76 }, y: 0, animIn: A("zoom-in", 0.4) },
    ],
    stickers: [{ id: "label-new", start: 0.5, duration: 2.5, x: 0.36, y: -0.3, scale: 0.18, loop: "pulse" }],
    whooshOnCuts: true,
  },
  {
    id: "sale-shorts", name: "할인 쇼츠", category: "비즈니스", description: "세로 화면, 강조 라벨과 흔들림, 코인 효과음", accent: "#ef476f",
    aspect: "9:16", slots: 4, slotDuration: 2, transitions: ["slideup", "pixelize"], transitionDuration: 0.35, filter: { id: "land-vivid", intensity: 0.6 }, camera: "zoom-in", canvas: { type: "blur", color: "#000000", blur: 0.6 },
    texts: [{ start: 0.1, duration: 7.8, content: "최대 50% 할인", style: { bold: true, color: "#ffffff", strokeWidth: 0, background: "#ef476f", bgRadius: 16, fontSize: 110 }, y: -0.32, animIn: A("drop", 0.6), animLoop: A("pulse", 0.8) }],
    stickers: [{ id: "label-sale", start: 0.5, duration: 7, x: 0.28, y: 0.32, scale: 0.3, loop: "wiggle" }],
    sounds: [{ id: "coin", start: 0.6 }],
    bgm: "bgm-house-upbeat",
  },
  {
    id: "cinematic-trailer", name: "시네마틱 트레일러", category: "시네마틱", description: "시네마 바, 틸앤오렌지, 검정 페이드와 긴장감 음악", accent: "#073b4c",
    aspect: "16:9", slots: 5, slotDuration: 2.4, transitions: ["fadeblack"], transitionDuration: 0.8, filter: { id: "film-teal-orange", intensity: 0.9 }, camera: "zoom-in",
    texts: [
      { start: 0.5, duration: 2.5, content: "올 가을", style: { fontFamily: "Georgia", bold: false, strokeWidth: 0, letterSpacing: 20, fontSize: 90 }, y: 0, animIn: A("fade", 1), animOut: A("fade", 0.6) },
      { start: -3, duration: 2.8, content: "THE LAST DAY", style: { fontFamily: "Georgia", bold: true, strokeWidth: 0, letterSpacing: 30, fontSize: 130, glow: "#ffb066" }, y: 0, animIn: A("stretch", 1.2) },
    ],
    effects: [{ id: "letterbox", start: 0, duration: 12, params: { size: 0.12 } }, { id: "fade-black", start: 0, duration: 1 }],
    sounds: [{ id: "boom", start: 0 }],
    bgm: "bgm-cinematic-tension",
  },
  {
    id: "cinematic-epic", name: "에픽 오프닝", category: "시네마틱", description: "천천히 줌 인, 몽환 글로우, 거대한 타이틀", accent: "#3a506b",
    aspect: "16:9", slots: 3, slotDuration: 4, transitions: ["fade"], transitionDuration: 1.2, filter: { id: "film-epic", intensity: 0.85 },
    texts: [{ start: 1, duration: 4, content: "LEGEND", style: { fontFamily: "Georgia", bold: true, strokeWidth: 0, letterSpacing: 50, fontSize: 170, color: "#f6e7c1", color2: "#b08d57" }, y: 0, animIn: A("zoom-out", 1.5), animOut: A("fade", 1) }],
    effects: [{ id: "ken-burns", start: 0, duration: 12, params: { strength: 0.25 } }, { id: "dream", start: 0, duration: 4, params: { strength: 0.4 } }, { id: "letterbox", start: 0, duration: 12, params: { size: 0.1 } }],
    sounds: [{ id: "riser", start: 0 }, { id: "boom", start: 2 }],
    bgm: "bgm-cinematic-tension",
  },
  {
    id: "retro-vhs", name: "레트로 VHS", category: "레트로", description: "VHS 효과와 필름 날짜, 크로스 프로세스 색감", accent: "#9b5de5",
    aspect: "16:9", slots: 5, slotDuration: 2.5, transitions: ["pixelize", "hblur"], transitionDuration: 0.5, filter: { id: "retro-vhs", intensity: 1 }, camera: "none",
    texts: [{ start: 0, duration: 12.5, content: "PLAY ▶  1998.08.15", style: { fontFamily: "Consolas", bold: false, color: "#ffffff", strokeWidth: 0, glow: "#ffffff", fontSize: 48 }, x: -0.3, y: -0.4, animLoop: A("flicker", 2) }],
    effects: [{ id: "vhs", start: 0, duration: 12.5, params: { strength: 0.7 } }],
    sounds: [{ id: "click", start: 0 }],
    bgm: "bgm-lofi-chill",
  },
  {
    id: "retro-film", name: "오래된 필름", category: "레트로", description: "세피아 필름과 흔들리는 카메라, 감성 자막", accent: "#c08552",
    aspect: "16:9", slots: 4, slotDuration: 3, transitions: ["fadeblack", "fade"], transitionDuration: 0.8, filter: { id: "retro-70s", intensity: 0.7 },
    texts: [{ start: 0.5, duration: 3, content: "그 시절 우리", style: { fontFamily: "Batang", bold: false, color: "#f5e6c8", strokeWidth: 0, shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 8, fontSize: 96 }, y: 0.3, animIn: A("fade", 1.2), animOut: A("fade", 1) }],
    effects: [{ id: "old-film", start: 0, duration: 12, params: { strength: 0.6 } }, { id: "handheld", start: 0, duration: 12, params: { strength: 0.3, speed: 0.08 } }],
    bgm: "bgm-ambient-dream",
  },
  {
    id: "mood-pastel", name: "파스텔 감성", category: "감성", description: "파스텔 색감, 몽글몽글 자막, 하트 스티커", accent: "#cdb4db",
    aspect: "1:1", slots: 4, slotDuration: 3, transitions: ["dissolve", "fade"], transitionDuration: 0.8, filter: { id: "mood-pastel", intensity: 0.9 }, camera: "alternate",
    texts: [{ start: 0.4, duration: 3.5, content: "몽글몽글한 하루", style: { color: "#fff4fb", strokeColor: "#ff9ccf", strokeWidth: 6, fontSize: 96 }, y: 0.32, animIn: A("rise", 0.8), animLoop: A("float", 2.4) }],
    stickers: [{ id: "heart", start: 0.6, duration: 3, x: 0.32, y: -0.32, scale: 0.16, loop: "heartbeat" }, { id: "sparkle", start: 3.4, duration: 3, x: -0.32, y: -0.3, scale: 0.15, loop: "flicker" }],
    bgm: "bgm-ambient-dream",
  },
  {
    id: "mood-night", name: "네온 나이트", category: "감성", description: "사이버펑크 색감, 글리치 전환, 네온 제목", accent: "#f15bb5",
    aspect: "9:16", slots: 5, slotDuration: 2, transitions: ["pixelize", "radial"], transitionDuration: 0.4, filter: { id: "neon-cyber", intensity: 0.9 }, camera: "zoom-in", canvas: { type: "blur", color: "#000000", blur: 0.5 },
    texts: [{ start: 0.2, duration: 3, content: "NIGHT\nVIBES", style: { bold: true, color: "#ffffff", glow: "#ff3df2", strokeWidth: 0, fontSize: 150 }, y: 0, animIn: A("blink", 0.8), animLoop: A("flicker", 1.4) }],
    effects: [{ id: "glitch", start: 0, duration: 0.8, params: { strength: 0.6 } }, { id: "glow", start: 0, duration: 10, params: { strength: 0.35 } }],
    bgm: "bgm-house-upbeat",
  },
  {
    id: "shorts-reaction", name: "리액션 쇼츠", category: "쇼츠", description: "감탄 스티커와 줌 펄스, 예능 자막", accent: "#ffbe0b",
    aspect: "9:16", slots: 3, slotDuration: 2.5, transitions: ["zoomin"], transitionDuration: 0.3, camera: "zoom-in", canvas: { type: "blur", color: "#000000", blur: 0.7 },
    texts: [{ start: 0.2, duration: 7, content: "이게 실화?!", style: { bold: true, color: "#ffe14d", strokeColor: "#000000", strokeWidth: 10, fontSize: 120 }, y: -0.33, animIn: A("pop", 0.3), animLoop: A("shake", 1) }],
    stickers: [{ id: "exclaim-wow", start: 1.5, duration: 2, x: 0.25, y: 0.25, scale: 0.3, loop: "pulse" }, { id: "exclaim-omg", start: 4, duration: 2.5, x: -0.25, y: 0.25, scale: 0.3, loop: "wiggle" }],
    effects: [{ id: "zoom-pulse", start: 1.5, duration: 1, params: { strength: 0.5, speed: 2 } }],
    sounds: [{ id: "pop", start: 1.5 }, { id: "boom", start: 4 }],
  },
  {
    id: "recipe", name: "레시피", category: "브이로그", description: "단계 번호 자막과 깔끔한 컷, 따뜻한 식탁 색감", accent: "#e76f51",
    aspect: "1:1", slots: 5, slotDuration: 3, transitions: ["wipeleft"], transitionDuration: 0.4, filter: { id: "food-warm", intensity: 0.8 }, camera: "zoom-in",
    texts: ["STEP 1", "STEP 2", "STEP 3", "STEP 4", "완성!"].map((c, i) => ({ start: i * 3 + 0.2, duration: 2.4, content: c, style: { bold: true, color: "#ffffff", strokeWidth: 0, background: "#e76f51", bgRadius: 30, fontSize: 70 }, x: -0.3, y: -0.38, animIn: A("slide-right", 0.35) })),
    sounds: [{ id: "ding", start: 12.2 }],
    bgm: "bgm-lofi-chill",
  },
];

export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];
