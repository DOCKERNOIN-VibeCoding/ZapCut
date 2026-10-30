// 타이틀 템플릿 엔진: 여러 레이어(텍스트·도형)와 레이어별 시간차 애니메이션 (docs/cleanroom/TITLE-TEMPLATES.ko.md)
// renderTitle은 미리보기 텍스처·썸네일·내보내기 PNG가 함께 쓰는 함수다. 같은 입력이면 같은 그림 (무작위는 시드 고정).
// 좌표·크기 단위는 1080p 기준 px, 타이틀 중심이 원점.
import type { TextStyle } from "./types";

export type TitleEase = "linear" | "in" | "out" | "inOut" | "back" | "elastic";
const EASE: Record<TitleEase, (p: number) => number> = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - (1 - p) ** 3,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
  back: (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2,
  elastic: (p) => (p <= 0 || p >= 1 ? p : 2 ** (-10 * p) * Math.sin(((p * 10 - 0.75) * 2 * Math.PI) / 3) + 1),
};

/** 제자리 대비 상태. 등장은 이 상태에서 제자리로, 퇴장은 제자리에서 이 상태로 */
export interface Offset {
  x?: number;
  y?: number;
  scale?: number;
  sx?: number; // 가로 배율 (선이 가운데서 늘어나는 효과 등)
  sy?: number;
  rotation?: number; // 도
  opacity?: number;
}
export type Reveal = "typewriter" | "scramble" | "wipe-right" | "wipe-left" | "wipe-up" | "wipe-down" | "wipe-center" | "draw";
export type UnitOrder = "ltr" | "rtl" | "center" | "edges" | "random";

export interface LayerAnim {
  at: number; // 등장: 클립 시작 후 초, 퇴장: 클립 끝 몇 초 전에 시작
  dur: number;
  ease?: TitleEase;
  offset?: Offset;
  per?: "char" | "word" | "line"; // 있으면 단위마다 같은 움직임을 시간차로
  order?: UnitOrder;
  stagger?: number; // 단위 사이 간격(초)
  reveal?: Reveal;
}
export interface LoopAnim {
  kind: "blink" | "pulse" | "float" | "spin" | "swing";
  period: number;
  amount?: number; // pulse: 배율 변화, float: px, swing: 도
}

export type TitleTextStyle = Partial<Omit<TextStyle, "content">> & { weight?: number };
export interface TitleText {
  label: string; // 속성 패널에 보이는 이름 ("제목", "날짜" …)
  content: string;
  style: TitleTextStyle;
}
export interface TitleShape {
  type: "rect" | "ellipse" | "line" | "arc" | "path";
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  a0?: number; // 호: 시작·끝 각도(도, 0 = 오른쪽, 시계 방향)
  a1?: number;
  d?: string; // 경로: vw×vh 좌표계의 SVG 경로
  vw?: number;
  vh?: number;
  dash?: number[];
  fit?: { layer: string; padX: number; padY: number }; // 텍스트 레이어 크기 + 여백으로 맞춤
}
export interface TitleLayer {
  id: string;
  x: number;
  y: number;
  rotation?: number;
  attach?: { layer: string; side: "left" | "right" | "top" | "bottom"; gap: number }; // 다른 레이어 가장자리에 붙임 (x, y는 추가 이동)
  text?: TitleText;
  shape?: TitleShape;
  in?: LayerAnim;
  out?: LayerAnim;
  loop?: LoopAnim;
}
export interface Title {
  layers: TitleLayer[];
}

const TEXT_DEFAULT: TextStyle = {
  content: "",
  fontFamily: "Pretendard",
  fontSize: 80,
  color: "#ffffff",
  bold: true,
  italic: false,
  align: "center",
  strokeColor: "#000000",
  strokeWidth: 0,
  background: "",
};

const textStyle = (t: TitleText): TextStyle & { weight?: number } => ({ ...TEXT_DEFAULT, ...t.style, content: t.content });
const titleFont = (s: TextStyle & { weight?: number }) =>
  `${s.italic ? "italic " : ""}${s.weight ?? (s.bold ? 800 : 400)} ${s.fontSize}px "${s.fontFamily}", "Pretendard", "Malgun Gothic", sans-serif`;

// ── 단위(글자·단어·줄)와 시간 ──

interface Unit {
  text: string;
  line: number;
  start: number; // 줄 안의 시작 글자 위치
}

function unitsOf(content: string, per: LayerAnim["per"]): Unit[] {
  const out: Unit[] = [];
  content.split("\n").forEach((line, li) => {
    const chars = [...line];
    if (per === "line") out.push({ text: line, line: li, start: 0 });
    else if (per === "word") {
      let i = 0;
      for (const w of line.split(/(\s+)/)) {
        if (w.trim()) out.push({ text: w, line: li, start: i });
        i += [...w].length;
      }
    } else chars.forEach((c, i) => c.trim() && out.push({ text: c, line: li, start: i }));
  });
  return out;
}

function hash(a: number, b: number, c = 0) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
const seedOf = (s: string) => [...s].reduce((a, c) => Math.imul(a, 31) + c.charCodeAt(0), 7);

/** 단위 i의 시간차 순번 */
function rankOf(i: number, n: number, order: UnitOrder | undefined, seed: number) {
  const c = (n - 1) / 2;
  switch (order) {
    case "rtl":
      return n - 1 - i;
    case "center":
      return Math.abs(i - c);
    case "edges":
      return c - Math.abs(i - c);
    case "random": {
      const keys = Array.from({ length: n }, (_, k) => hash(seed, k));
      return keys.filter((v) => v < keys[i]).length;
    }
    default:
      return i;
  }
}

const unitCount = (l: TitleLayer, a: LayerAnim) => (a.per && l.text ? unitsOf(l.text.content, a.per).length : 1);
const maxRank = (l: TitleLayer, a: LayerAnim) => {
  const n = unitCount(l, a);
  return a.order === "center" || a.order === "edges" ? (n - 1) / 2 : n - 1;
};
/** 애니메이션 전체 길이 (마지막 단위까지) */
const span = (l: TitleLayer, a: LayerAnim) => a.dur + Math.max(0, maxRank(l, a)) * (a.stagger ?? 0);

/** 내보내기·미리보기 캐시용: 움직이는 구간 */
export function titleTiming(title: Title, D: number) {
  let inEnd = 0;
  let outStart = D;
  let loop = false;
  for (const l of title.layers) {
    if (l.in) inEnd = Math.max(inEnd, l.in.at + span(l, l.in));
    if (l.out) outStart = Math.min(outStart, D - l.out.at);
    if (l.loop) loop = true;
  }
  return { inEnd: Math.min(D, inEnd), outStart: Math.max(0, outStart), loop };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 등장(0→1)·퇴장(0→1) 진행도 (이징 적용 전) */
function progress(a: LayerAnim | undefined, T: number, D: number, rank: number, kind: "in" | "out") {
  if (!a) return kind === "in" ? 1 : 0;
  const start = (kind === "in" ? a.at : D - a.at) + rank * (a.stagger ?? 0);
  return a.dur > 0 ? clamp01((T - start) / a.dur) : T >= start ? 1 : 0;
}

interface State {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number;
  opacity: number;
}
function stateAt(inA: LayerAnim | undefined, outA: LayerAnim | undefined, pin: number, pout: number): State {
  const ei = 1 - EASE[inA?.ease ?? "out"](pin); // 등장 상태가 남은 정도
  const eo = EASE[outA?.ease ?? "in"](pout);
  const o1 = inA?.offset ?? {};
  const o2 = outA?.offset ?? {};
  const mul = (a: number | undefined, b: number | undefined) => (1 + ((a ?? 1) - 1) * ei) * (1 + ((b ?? 1) - 1) * eo);
  return {
    x: (o1.x ?? 0) * ei + (o2.x ?? 0) * eo,
    y: (o1.y ?? 0) * ei + (o2.y ?? 0) * eo,
    sx: mul(o1.scale, o2.scale) * mul(o1.sx, o2.sx),
    sy: mul(o1.scale, o2.scale) * mul(o1.sy, o2.sy),
    rotation: (o1.rotation ?? 0) * ei + (o2.rotation ?? 0) * eo,
    opacity: clamp01(mul(o1.opacity, o2.opacity)),
  };
}

// ── 배치 ──

interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
}
interface Layout {
  boxes: Map<string, Box>;
  half: { w: number; h: number }; // 원점 대칭 반쪽 크기 (애니메이션 범위 포함)
}

let measureCtx: CanvasRenderingContext2D | undefined;
function measure(style: TextStyle & { weight?: number }) {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const ctx = measureCtx;
  ctx.font = titleFont(style);
  ctx.letterSpacing = `${style.letterSpacing ?? 0}px`;
  const lines = style.content.split("\n");
  const lineH = style.fontSize * (style.lineHeight ?? 1.2);
  return { w: Math.max(1, ...lines.map((l) => ctx.measureText(l).width)), h: lines.length * lineH, lineH };
}

const layoutCache = new WeakMap<Title, Layout>();
function layoutTitle(title: Title): Layout {
  const cached = layoutCache.get(title);
  if (cached) return cached;
  const byId = new Map(title.layers.map((l) => [l.id, l]));
  const sizes = new Map<string, { w: number; h: number }>();
  const sizeOf = (l: TitleLayer): { w: number; h: number } => {
    const got = sizes.get(l.id);
    if (got) return got;
    let s = { w: 0, h: 0 };
    if (l.text) s = measure(textStyle(l.text));
    else if (l.shape) {
      const f = l.shape.fit && byId.get(l.shape.fit.layer);
      s = f ? { w: sizeOf(f).w + l.shape.fit!.padX * 2, h: sizeOf(f).h + l.shape.fit!.padY * 2 } : { w: l.shape.w, h: l.shape.h };
    }
    sizes.set(l.id, s);
    return s;
  };
  const boxes = new Map<string, Box>();
  const boxOf = (l: TitleLayer, depth = 0): Box => {
    const got = boxes.get(l.id);
    if (got) return got;
    const { w, h } = sizeOf(l);
    let cx = l.x;
    let cy = l.y;
    const other = l.attach && depth < 8 ? byId.get(l.attach.layer) : undefined;
    if (other) {
      const o = boxOf(other, depth + 1);
      const g = l.attach!.gap;
      if (l.attach!.side === "left") (cx += o.cx - o.w / 2 - g - w / 2), (cy += o.cy);
      else if (l.attach!.side === "right") (cx += o.cx + o.w / 2 + g + w / 2), (cy += o.cy);
      else if (l.attach!.side === "top") (cx += o.cx), (cy += o.cy - o.h / 2 - g - h / 2);
      else (cx += o.cx), (cy += o.cy + o.h / 2 + g + h / 2);
    } else if (l.shape?.fit && byId.get(l.shape.fit.layer)) {
      // 맞춘 레이어와 같은 자리 (x, y는 추가 이동)
      const o = boxOf(byId.get(l.shape.fit.layer)!, depth + 1);
      cx += o.cx;
      cy += o.cy;
    }
    const b = { cx, cy, w, h };
    boxes.set(l.id, b);
    return b;
  };
  let hw = 1;
  let hh = 1;
  for (const l of title.layers) {
    const b = boxOf(l);
    // 회전·배율·이동 애니메이션까지 들어가도록 넉넉하게
    const offs = [l.in?.offset, l.out?.offset].filter(Boolean) as Offset[];
    const grow = Math.max(1, ...offs.map((o) => Math.max(o.scale ?? 1, (o.scale ?? 1) * (o.sx ?? 1), (o.scale ?? 1) * (o.sy ?? 1))), l.loop?.kind === "pulse" ? 1 + (l.loop.amount ?? 0.08) : 1);
    const turns = !!l.rotation || offs.some((o) => o.rotation) || l.loop?.kind === "spin" || l.loop?.kind === "swing";
    const r = turns ? Math.hypot(b.w, b.h) / 2 : 0;
    const ex = (turns ? r : b.w / 2) * grow + Math.max(0, ...offs.map((o) => Math.abs(o.x ?? 0)));
    const ey = (turns ? r : b.h / 2) * grow + Math.max(0, ...offs.map((o) => Math.abs(o.y ?? 0))) + (l.loop?.kind === "float" ? (l.loop.amount ?? 10) : 0);
    const s = l.text ? textStyle(l.text) : undefined;
    const pad = (s ? Math.max(s.strokeWidth * 2, (s.shadowBlur ?? 0) + Math.max(Math.abs(s.shadowX ?? 0), Math.abs(s.shadowY ?? 0)), s.glow ? s.fontSize * 0.4 : 0, s.fontSize * 0.2) : (l.shape?.strokeWidth ?? 0)) + 4;
    hw = Math.max(hw, Math.abs(b.cx) + ex + pad);
    hh = Math.max(hh, Math.abs(b.cy) + ey + pad);
  }
  const L = { boxes, half: { w: hw, h: hh } };
  layoutCache.set(title, L);
  return L;
}

/** 타이틀 전체 크기 (1080 기준 px, 애니메이션 범위 포함) */
export function titleExtent(title: Title) {
  const { half } = layoutTitle(title);
  return { w: half.w * 2, h: half.h * 2 };
}

// ── 그리기 ──

const pathLengths = new Map<string, number>();
function pathLength(d: string) {
  let len = pathLengths.get(d);
  if (len === undefined) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
    el.setAttribute("d", d);
    len = el.getTotalLength();
    pathLengths.set(d, len);
  }
  return len;
}

function shapeLength(s: TitleShape, w: number, h: number) {
  switch (s.type) {
    case "rect":
      return 2 * (w + h);
    case "line":
      return Math.hypot(w, h);
    case "path":
      return s.d ? pathLength(s.d) : 0;
    default: {
      const a = w / 2;
      const b = h / 2;
      const full = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      return s.type === "arc" ? (full * Math.abs((s.a1 ?? 360) - (s.a0 ?? 0))) / 360 : full;
    }
  }
}

function drawShape(ctx: CanvasRenderingContext2D, s: TitleShape, w: number, h: number, draw: number) {
  ctx.save();
  let lw = s.strokeWidth ?? 0;
  ctx.beginPath();
  if (s.type === "rect") ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(s.radius ?? 0, w / 2, h / 2));
  else if (s.type === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s.type === "line") {
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2);
  } else if (s.type === "arc") ctx.ellipse(0, 0, w / 2, h / 2, 0, ((s.a0 ?? 0) * Math.PI) / 180, ((s.a1 ?? 360) * Math.PI) / 180);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  let path: Path2D | undefined;
  if (s.type === "path" && s.d) {
    const kx = w / (s.vw ?? 24);
    const ky = h / (s.vh ?? 24);
    ctx.translate(-w / 2, -h / 2);
    ctx.scale(kx, ky);
    lw /= (kx + ky) / 2;
    path = new Path2D(s.d);
  }
  if (s.fill) {
    ctx.globalAlpha *= draw < 1 && s.stroke ? draw : 1;
    ctx.fillStyle = s.fill;
    if (path) ctx.fill(path);
    else ctx.fill();
  }
  const len = s.stroke && lw > 0 ? shapeLength(s, s.type === "path" ? (s.vw ?? 24) : w, s.type === "path" ? (s.vh ?? 24) : h) : 0;
  // 그리기 시작 직후 둥근 끝 때문에 점만 찍히지 않게, 길이가 생긴 뒤부터 그린다
  if (len > 0 && len * draw >= lw) {
    if (draw < 1) ctx.setLineDash([len * draw, len + 1]);
    else if (s.dash) ctx.setLineDash(s.dash);
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.stroke!;
    if (path) ctx.stroke(path);
    else ctx.stroke();
  }
  ctx.restore();
}

const HANGUL = "가나다라마바사아자차카타파하고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후";
function scrambleChar(c: string, a: number, b: number, seed: number) {
  const r = hash(a, b, seed);
  if (/[A-Z]/.test(c)) return String.fromCharCode(65 + Math.floor(r * 26));
  if (/[a-z]/.test(c)) return String.fromCharCode(97 + Math.floor(r * 26));
  if (/[0-9]/.test(c)) return String(Math.floor(r * 10));
  if (/[가-힣]/.test(c)) return HANGUL[Math.floor(r * HANGUL.length)];
  return c;
}

/** 닦아내기: 보이는 부분만 남기는 클립 영역 */
function wipeClip(ctx: CanvasRenderingContext2D, reveal: Reveal, w: number, h: number, p: number) {
  const W = w + 8;
  const H = h + 8;
  ctx.beginPath();
  if (reveal === "wipe-right") ctx.rect(-W / 2, -H / 2, W * p, H);
  else if (reveal === "wipe-left") ctx.rect(W / 2 - W * p, -H / 2, W * p, H);
  else if (reveal === "wipe-down") ctx.rect(-W / 2, -H / 2, W, H * p);
  else if (reveal === "wipe-up") ctx.rect(-W / 2, H / 2 - H * p, W, H * p);
  else ctx.rect((-W * p) / 2, -H / 2, W * p, H);
  ctx.clip();
}

function loopState(l: LoopAnim | undefined, T: number): { dx: number; dy: number; scale: number; rotation: number; opacity: number } {
  const id = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };
  if (!l || l.period <= 0) return id;
  const ph = (T % l.period) / l.period;
  const s = Math.sin(ph * Math.PI * 2);
  switch (l.kind) {
    case "blink":
      return { ...id, opacity: ph < 0.5 ? 1 : 0 };
    case "pulse":
      return { ...id, scale: 1 + (l.amount ?? 0.08) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)) };
    case "float":
      return { ...id, dy: (l.amount ?? 10) * s };
    case "spin":
      return { ...id, rotation: ph * 360 };
    case "swing":
      return { ...id, rotation: (l.amount ?? 8) * s };
  }
}

/** k = 출력 배율. 캔버스 그림자 크기·거리는 변환 배율을 따르지 않으므로 직접 곱한다 */
function drawText(ctx: CanvasRenderingContext2D, l: TitleLayer, box: Box, T: number, D: number, seed: number, k: number) {
  const s = textStyle(l.text!);
  ctx.font = titleFont(s);
  ctx.letterSpacing = `${s.letterSpacing ?? 0}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const lines = s.content.split("\n");
  const lineH = s.fontSize * (s.lineHeight ?? 1.2);
  const lineW = lines.map((t) => ctx.measureText(t).width);
  const lineX = (i: number) => (s.align === "left" ? -box.w / 2 : s.align === "right" ? box.w / 2 - lineW[i] : -lineW[i] / 2);
  const lineY = (i: number) => -box.h / 2 + lineH * (i + 0.5);
  // 단위로 움직이는 애니메이션이 있으면 그 단위로 나눠 그린다 (없으면 줄 단위 한 덩어리)
  const per = l.in?.per ?? l.out?.per;
  const units = unitsOf(s.content, per ?? "line");
  const n = units.length;
  const items = units.map((u, i) => {
    const line = lines[u.line];
    const before = [...line].slice(0, u.start).join("");
    const x0 = lineX(u.line) + ctx.measureText(before).width;
    const w = ctx.measureText(u.text).width;
    const pin = l.in?.per ? progress(l.in, T, D, rankOf(i, n, l.in.order, seed), "in") : 1;
    const pout = l.out?.per ? progress(l.out, T, D, rankOf(i, n, l.out.order, seed + 1), "out") : 0;
    const st = stateAt(l.in?.per ? l.in : undefined, l.out?.per ? l.out : undefined, pin, pout);
    let text = u.text;
    const reveal = l.in?.reveal;
    if (reveal === "typewriter" && pin <= 0) st.opacity = 0;
    if (reveal === "scramble") {
      if (pin <= 0) st.opacity = 0;
      else if (pin < 1) text = [...text].map((c, k) => scrambleChar(c, i * 31 + k, Math.floor(T * 24), seed)).join("");
    }
    return { text, x: x0, cx: x0 + w / 2, cy: lineY(u.line), st };
  });
  const fill = () => {
    if (!s.color2) return s.color;
    const g = ctx.createLinearGradient(0, -box.h / 2, 0, box.h / 2);
    g.addColorStop(0, s.color);
    g.addColorStop(1, s.color2);
    return g;
  };
  const each = (paint: (text: string, x: number, y: number) => void) => {
    for (const it of items) {
      if (it.st.opacity <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= it.st.opacity;
      ctx.translate(it.cx + it.st.x, it.cy + it.st.y);
      ctx.rotate((it.st.rotation * Math.PI) / 180);
      ctx.scale(it.st.sx, it.st.sy);
      paint(it.text, it.x - it.cx, 0);
      ctx.restore();
    }
  };
  // 그림자·빛 → 외곽선 → 채우기 순으로 단계마다 전체를 그려 겹침이 자연스럽게
  if (s.glow) {
    each((t, x, y) => {
      ctx.shadowColor = s.glow!;
      ctx.fillStyle = s.glow!;
      for (const blur of [s.fontSize * 0.35, s.fontSize * 0.15]) {
        ctx.shadowBlur = blur * k;
        ctx.fillText(t, x, y);
      }
    });
  }
  if (s.shadowColor && (s.shadowBlur || s.shadowX || s.shadowY)) {
    each((t, x, y) => {
      ctx.shadowColor = s.shadowColor!;
      ctx.shadowBlur = (s.shadowBlur ?? 0) * k;
      ctx.shadowOffsetX = (s.shadowX ?? 0) * k;
      ctx.shadowOffsetY = (s.shadowY ?? 0) * k;
      ctx.fillStyle = s.shadowColor!;
      ctx.fillText(t, x, y);
    });
  }
  if (s.strokeWidth > 0) {
    each((t, x, y) => {
      ctx.lineJoin = "round";
      ctx.lineWidth = s.strokeWidth * 2;
      ctx.strokeStyle = s.strokeColor;
      ctx.strokeText(t, x, y);
    });
  }
  each((t, x, y) => {
    ctx.fillStyle = fill();
    ctx.fillText(t, x, y);
  });
}

/**
 * 시간 T(클립 안, 초)의 타이틀을 그린다. D = 클립 길이, Href = 출력 높이(1080 기준 배율).
 * 캔버스 크기는 T와 무관하게 일정하다.
 */
export function renderTitle(title: Title, T: number, D: number, Href: number, target?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = target ?? document.createElement("canvas");
  const L = layoutTitle(title);
  const k = Href / 1080;
  const W = Math.max(2, Math.ceil(L.half.w * 2 * k));
  const H = Math.max(2, Math.ceil(L.half.h * 2 * k));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, W / 2, H / 2);
  title.layers.forEach((l, li) => {
    const box = L.boxes.get(l.id)!;
    const seed = seedOf(l.id) + li;
    // 레이어 전체 움직임 (단위 애니메이션은 drawText에서)
    const pin = l.in && !l.in.per ? progress(l.in, T, D, 0, "in") : 1;
    const pout = l.out && !l.out.per ? progress(l.out, T, D, 0, "out") : 0;
    const st = stateAt(l.in && !l.in.per ? l.in : undefined, l.out && !l.out.per ? l.out : undefined, pin, pout);
    const lp = loopState(l.loop, T);
    const alpha = st.opacity * lp.opacity;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(box.cx + st.x + lp.dx, box.cy + st.y + lp.dy);
    ctx.rotate((((l.rotation ?? 0) + st.rotation + lp.rotation) * Math.PI) / 180);
    ctx.scale(st.sx * lp.scale, st.sy * lp.scale);
    // 드러내기(닦아내기·선 그리기)는 레이어 전체 진행도로
    const revealP = (a: LayerAnim | undefined, kind: "in" | "out") => {
      if (!a) return kind === "in" ? 1 : 0;
      const total = span(l, a);
      const start = kind === "in" ? a.at : D - a.at;
      return EASE[a.ease ?? (kind === "in" ? "out" : "in")](clamp01(total > 0 ? (T - start) / total : 1));
    };
    let draw = 1;
    for (const [a, kind] of [[l.in, "in"], [l.out, "out"]] as const) {
      const r = a?.reveal;
      if (!r || r === "typewriter" || r === "scramble") continue;
      const p = kind === "in" ? revealP(a, "in") : 1 - revealP(a, "out");
      if (r === "draw") draw = Math.min(draw, p);
      else wipeClip(ctx, r, box.w, box.h, p);
    }
    if (l.shape) {
      if (draw > 0) drawShape(ctx, l.shape, box.w, box.h, draw);
    } else if (l.text?.content) drawText(ctx, l, box, T, D, seed, k);
    ctx.restore();
  });
  return canvas;
}

// ── 템플릿 → 클립 ──

const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_KO = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** 날짜·시간 자리표시를 채운다 ({YYYY} {YY} {MM} {M} {DD} {D} {MON} {Mon} {Week} {WEEK} {요일} {HH} {hh} {mm} {AMPM}) */
export function fillTokens(s: string, d = new Date()) {
  const h12 = d.getHours() % 12 || 12;
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(2),
    MM: pad2(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    D: String(d.getDate()),
    MON: MONTH_EN[d.getMonth()],
    Mon: MONTH_EN[d.getMonth()][0] + MONTH_EN[d.getMonth()].slice(1).toLowerCase(),
    WEEK: WEEK_EN[d.getDay()].toUpperCase(),
    Week: WEEK_EN[d.getDay()],
    요일: WEEK_KO[d.getDay()],
    HH: pad2(d.getHours()),
    hh: pad2(h12),
    mm: pad2(d.getMinutes()),
    AMPM: d.getHours() < 12 ? "AM" : "PM",
  };
  return s.replace(/\{(YYYY|YY|MM|M|DD|D|MON|Mon|WEEK|Week|요일|HH|hh|mm|AMPM)\}/g, (_, k: string) => map[k]);
}

/** 템플릿 정의를 클립용 사본으로 (자리표시 채움) */
export function instantiateTitle(def: Title, d = new Date()): Title {
  return { layers: def.layers.map((l) => (l.text ? { ...l, text: { ...l.text, content: fillTokens(l.text.content, d) } } : l)) };
}

/** 타임라인 표시용 이름: 첫 텍스트 레이어 */
export const titleLabel = (t: Title) => t.layers.find((l) => l.text)?.text!.content.split("\n")[0] ?? "타이틀";
