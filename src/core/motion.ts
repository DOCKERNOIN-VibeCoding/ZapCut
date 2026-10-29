// 키프레임 + 인/아웃/반복 애니메이션 → FFmpeg 수식 (변수 T = 클립 내부 시간, 초)
// 미리보기는 같은 수식을 expr.ts로 계산하므로 내보내기와 움직임이 일치한다.
import { compile, num } from "./expr";
import type { AnimRef, Clip, Easing, KfProp, Keyframe } from "./types";

export function easeExpr(ease: Easing, p: string): string {
  switch (ease) {
    case "easeIn":
      return `pow(${p},3)`;
    case "easeOut":
      return `(1-pow(1-${p},3))`;
    case "easeInOut":
      return `(${p}*${p}*(3-2*${p}))`;
    case "hold":
      return "0";
    default:
      return p;
  }
}

/** 키프레임 → 수식. 키가 없으면 base 상수 */
export function keyframeExpr(keys: Keyframe[] | undefined, base: number, T = "T"): string {
  if (!keys || keys.length === 0) return num(base);
  const k = [...keys].sort((a, b) => a.t - b.t);
  if (k.length === 1) return num(k[0].v);
  let expr = num(k[k.length - 1].v);
  for (let i = k.length - 2; i >= 0; i--) {
    const a = k[i];
    const b = k[i + 1];
    const dt = Math.max(1e-6, b.t - a.t);
    const p = `clip((${T}-${num(a.t)})/${num(dt)},0,1)`;
    const seg = a.ease === "hold" ? num(a.v) : `(${num(a.v)}+${num(b.v - a.v)}*${easeExpr(a.ease, p)})`;
    expr = `if(lt(${T},${num(b.t)}),${seg},${expr})`;
  }
  return `if(lt(${T},${num(k[0].t)}),${num(k[0].v)},${expr})`;
}

/** JS에서 직접 키프레임 값을 계산 (UI 표시용) */
export function keyframeValue(keys: Keyframe[] | undefined, base: number, t: number) {
  return compile(keyframeExpr(keys, base))({ T: t });
}

// ── 애니메이션 정의 ─────────────────────────────────────────────
// q: 0 = 숨김 상태, 1 = 원래 상태. dx/dy는 캔버스 비율, s는 배율, r은 도, a는 불투명도 배율
interface Shape {
  dx?: (q: string) => string;
  dy?: (q: string) => string;
  s?: (q: string) => string;
  r?: (q: string) => string;
  a?: (q: string) => string;
}
export interface AnimDef {
  id: string;
  name: string;
  kind: "in" | "out" | "loop";
  shape?: Shape; // in/out
  linear?: boolean; // 이징 없이 진행도 그대로
  textOnly?: boolean;
  defaultDuration: number;
}

const back = (q: string) => `(1+2.70158*pow(${q}-1,3)+1.70158*pow(${q}-1,2))`;
const SHAPES: Record<string, { name: [string, string]; shape: Shape; linear?: boolean; textOnly?: boolean }> = {
  fade: { name: ["페이드 인", "페이드 아웃"], shape: { a: (q) => q } },
  "slide-up": { name: ["위로 슬라이드", "위로 사라지기"], shape: { dy: (q) => `0.15*(1-${q})`, a: (q) => q } },
  "slide-down": { name: ["아래로 슬라이드", "아래로 사라지기"], shape: { dy: (q) => `-0.15*(1-${q})`, a: (q) => q } },
  "slide-left": { name: ["왼쪽으로 슬라이드", "왼쪽으로 사라지기"], shape: { dx: (q) => `0.2*(1-${q})`, a: (q) => q } },
  "slide-right": { name: ["오른쪽으로 슬라이드", "오른쪽으로 사라지기"], shape: { dx: (q) => `-0.2*(1-${q})`, a: (q) => q } },
  "zoom-in": { name: ["줌 인", "줌 아웃 사라지기"], shape: { s: (q) => `(0.3+0.7*${q})`, a: (q) => q } },
  "zoom-out": { name: ["줌 아웃 등장", "커지며 사라지기"], shape: { s: (q) => `(1.6-0.6*${q})`, a: (q) => q } },
  spin: { name: ["회전 등장", "회전 퇴장"], shape: { r: (q) => `-180*(1-${q})`, s: (q) => `(0.3+0.7*${q})`, a: (q) => q } },
  pop: { name: ["통통 튀기", "통통 사라지기"], shape: { s: (q) => back(q), a: (q) => `min(1,${q}*3)` }, linear: true },
  drop: { name: ["떨어지기", "튀어 오르며 사라지기"], shape: { dy: (q) => `-0.35*(1-${back(q)})`, a: (q) => `min(1,${q}*4)` }, linear: true },
  rise: { name: ["솟아오르기", "가라앉기"], shape: { dy: (q) => `0.35*(1-${back(q)})`, a: (q) => `min(1,${q}*4)` }, linear: true },
  blink: { name: ["깜빡이며 등장", "깜빡이며 사라지기"], shape: { a: (q) => `if(lt(${q},1),gte(sin(${q}*PI*9),0),1)` }, linear: true },
  swing: { name: ["흔들며 등장", "흔들며 사라지기"], shape: { r: (q) => `30*(1-${q})*cos(${q}*PI*3)`, a: (q) => `min(1,${q}*2)` } },
  "zoom-rotate": { name: ["소용돌이", "소용돌이 퇴장"], shape: { r: (q) => `360*(1-${q})`, s: (q) => q, a: (q) => q } },
  stretch: { name: ["펼치기", "접기"], shape: { s: (q) => `(0.6+0.4*${q})`, dy: (q) => `0.04*(1-${q})`, a: (q) => q } },
  typewriter: { name: ["타자기", "지우기"], shape: {}, linear: true, textOnly: true },
};

export const IN_ANIMS: AnimDef[] = Object.entries(SHAPES).map(([id, d]) => ({ id, name: d.name[0], kind: "in", shape: d.shape, linear: d.linear, textOnly: d.textOnly, defaultDuration: 0.5 }));
export const OUT_ANIMS: AnimDef[] = Object.entries(SHAPES).map(([id, d]) => ({ id, name: d.name[1], kind: "out", shape: d.shape, linear: d.linear, textOnly: d.textOnly, defaultDuration: 0.5 }));

const LOOPS: Record<string, { name: string; f: (T: string, P: number) => { dx?: string; dy?: string; s?: string; r?: string; a?: string } }> = {
  pulse: { name: "두근두근", f: (T, P) => ({ s: `(1+0.06*sin(${T}*2*PI/${num(P)}))` }) },
  heartbeat: { name: "심장 박동", f: (T, P) => ({ s: `(1+0.12*pow(max(0,sin(${T}*2*PI/${num(P)})),6))` }) },
  float: { name: "둥실둥실", f: (T, P) => ({ dy: `(0.015*sin(${T}*2*PI/${num(P)}))` }) },
  swing: { name: "좌우 흔들기", f: (T, P) => ({ r: `(8*sin(${T}*2*PI/${num(P)}))` }) },
  spin: { name: "계속 회전", f: (T, P) => ({ r: `(360*${T}/${num(P)})` }) },
  shake: { name: "덜덜 떨기", f: (T) => ({ dx: `(0.006*sin(${T}*53))`, dy: `(0.006*sin(${T}*71))` }) },
  flicker: { name: "반짝반짝", f: (T, P) => ({ a: `(0.55+0.45*cos(${T}*2*PI/${num(P)}))` }) },
  wiggle: { name: "꿈틀꿈틀", f: (T, P) => ({ r: `(4*sin(${T}*2*PI/${num(P)}*2))`, s: `(1+0.03*sin(${T}*2*PI/${num(P)}))` }) },
  bounce: { name: "통통", f: (T, P) => ({ dy: `(-0.03*abs(sin(${T}*PI/${num(P)})))` }) },
};
export const LOOP_ANIMS: AnimDef[] = Object.entries(LOOPS).map(([id, d]) => ({ id, name: d.name, kind: "loop", defaultDuration: id === "spin" ? 3 : id === "shake" ? 1 : 1.2 }));

export const findAnim = (kind: "in" | "out" | "loop", id?: string) => (kind === "in" ? IN_ANIMS : kind === "out" ? OUT_ANIMS : LOOP_ANIMS).find((a) => a.id === id);

// ── 클립 움직임 수식 ─────────────────────────────────────────────
export interface MotionExprs {
  x: string;
  y: string;
  scale: string;
  rotation: string;
  opacity: string;
  /** 타자기 애니메이션 진행도(0..1), 없으면 undefined */
  typing?: string;
  typingOut?: string;
}

function animTerms(clip: Clip, T: string) {
  const dx: string[] = [];
  const dy: string[] = [];
  const s: string[] = [];
  const r: string[] = [];
  const a: string[] = [];
  const push = (sh: { dx?: string; dy?: string; s?: string; r?: string; a?: string }) => {
    if (sh.dx) dx.push(sh.dx);
    if (sh.dy) dy.push(sh.dy);
    if (sh.s) s.push(sh.s);
    if (sh.r) r.push(sh.r);
    if (sh.a) a.push(sh.a);
  };
  const D = clip.duration;
  let typing: string | undefined;
  let typingOut: string | undefined;
  const inA = clip.animIn && findAnim("in", clip.animIn.id);
  if (inA && clip.animIn) {
    const d = Math.min(clip.animIn.duration, D);
    const p = `clip(${T}/${num(d)},0,1)`;
    if (inA.id === "typewriter") typing = p;
    const q = inA.linear ? p : `(1-pow(1-${p},3))`;
    const sh = inA.shape!;
    push({ dx: sh.dx?.(q), dy: sh.dy?.(q), s: sh.s?.(q), r: sh.r?.(q), a: sh.a?.(q) });
  }
  const outA = clip.animOut && findAnim("out", clip.animOut.id);
  if (outA && clip.animOut) {
    const d = Math.min(clip.animOut.duration, D);
    const p = `clip((${T}-${num(D - d)})/${num(d)},0,1)`;
    if (outA.id === "typewriter") typingOut = `(1-${p})`;
    const q = outA.linear ? `(1-${p})` : `(1-pow(${p},3))`;
    const sh = outA.shape!;
    push({ dx: sh.dx?.(q), dy: sh.dy?.(q), s: sh.s?.(q), r: sh.r?.(q), a: sh.a?.(q) });
  }
  if (clip.animLoop && LOOPS[clip.animLoop.id]) push(LOOPS[clip.animLoop.id].f(T, Math.max(0.1, clip.animLoop.duration)));
  return { dx, dy, s, r, a, typing, typingOut };
}

export function motionExprs(clip: Clip, T = "T"): MotionExprs {
  const kf = clip.keyframes ?? {};
  const tr = clip.transform;
  const base = (p: KfProp, v: number) => keyframeExpr(kf[p]?.map((k) => k), v, T);
  const { dx, dy, s, r, a, typing, typingOut } = animTerms(clip, T);
  const sum = (b: string, xs: string[]) => (xs.length ? `(${[b, ...xs].join("+")})` : b);
  const prod = (b: string, xs: string[]) => (xs.length ? `(${[b, ...xs].join("*")})` : b);
  return {
    x: sum(base("x", tr.x), dx),
    y: sum(base("y", tr.y), dy),
    scale: prod(base("scale", tr.scale), s),
    rotation: sum(base("rotation", tr.rotation), r),
    opacity: prod(base("opacity", tr.opacity), a),
    typing,
    typingOut,
  };
}

export function volumeExpr(clip: Clip, T = "T") {
  return keyframeExpr(clip.keyframes?.volume, clip.volume, T);
}

export interface MotionValues {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  typing: number; // 표시할 글자 비율 0..1
}

/** 미리보기용: 클립 내부 시간 t에서의 값 */
export function motionAt(clip: Clip, t: number): MotionValues {
  const m = motionExprs(clip);
  const v = { T: t };
  const typingIn = m.typing ? compile(m.typing)(v) : 1;
  const typingOut = m.typingOut ? compile(m.typingOut)(v) : 1;
  return {
    x: compile(m.x)(v),
    y: compile(m.y)(v),
    scale: compile(m.scale)(v),
    rotation: compile(m.rotation)(v),
    opacity: Math.min(1, Math.max(0, compile(m.opacity)(v))),
    typing: Math.min(typingIn, typingOut),
  };
}

/** 클립 구간에서 수식의 최댓값 (내보내기 시 고정 캔버스 크기 계산용) */
export function maxOver(expr: string, duration: number, samples = 240) {
  const f = compile(expr);
  let m = -Infinity;
  for (let i = 0; i <= samples; i++) m = Math.max(m, f({ T: (duration * i) / samples }));
  return m;
}

export const hasMotion = (clip: Clip) =>
  !!(clip.animIn || clip.animOut || clip.animLoop || Object.values(clip.keyframes ?? {}).some((k) => k && k.length > 0));

export type { AnimRef };
