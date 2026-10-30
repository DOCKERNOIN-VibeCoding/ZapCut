// 전환 카탈로그. 내보내기는 FFmpeg xfade, 미리보기는 같은 동작의 셰이더(preview/shaders.ts)를 쓴다.
// 동작(방향·곡선)은 실제 xfade 출력을 측정해 맞췄다.
import { motionAt } from "./motion";
import { clipEnd } from "./timeline";
import type { Clip, MediaItem, Track } from "./types";

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

export interface TrackTransition {
  a: Clip;
  b: Clip;
  def: TransitionDef;
  d: number; // 실제 길이: 컷을 가운데 두고 앞뒤로 d/2씩
  cut: number;
}

/** 전환을 넣을 수 있는 컷: 같은 트랙에서 빈틈 없이 붙은 영상/사진 클립 쌍 */
export function adjacentPairs(track: Track): [Clip, Clip][] {
  const clips = track.clips.filter((c) => c.kind === "video" || c.kind === "image").sort((a, b) => a.start - b.start);
  const out: [Clip, Clip][] = [];
  clips.forEach((a, i) => {
    const b = clips[i + 1];
    if (b && Math.abs(b.start - clipEnd(a)) <= 0.01) out.push([a, b]);
  });
  return out;
}

/**
 * 트랙의 전환 (컷의 앞 클립에 저장). 길이는 양쪽 클립의 90%를 넘지 않는다.
 * 오버레이 트랙은 블렌드 모드를 쓰는 클립에는 적용하지 않는다 (전환 구간은 일반 합성이라서).
 */
export function trackTransitions(track: Track): TrackTransition[] {
  const out: TrackTransition[] = [];
  for (const [a, b] of adjacentPairs(track)) {
    const def = findTransition(a.transition?.id);
    if (!def) continue;
    if (!track.main && ((a.blend ?? "normal") !== "normal" || (b.blend ?? "normal") !== "normal")) continue;
    out.push({ a, b, def, d: Math.min(a.transition!.duration, a.duration * 0.9, b.duration * 0.9), cut: clipEnd(a) });
  }
  return out;
}

/**
 * 오버레이 전환이 일어나는 영역 (W×H 캔버스 픽셀, 캔버스 안으로 자름).
 * A가 끝날 때와 B가 시작할 때의 모습을 감싸는 상자 — 같은 자리면 그 클립 영역 그대로다.
 */
export function transitionRect(a: Clip, am: MediaItem | undefined, b: Clip, bm: MediaItem | undefined, W: number, H: number) {
  const box = (clip: Clip, m: MediaItem | undefined, T: number) => {
    const cr = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const sw = (m?.width || W) * (1 - cr.l - cr.r);
    const sh = (m?.height || H) * (1 - cr.t - cr.b);
    const mo = motionAt(clip, T);
    const fit = Math.min(W / sw, H / sh);
    const w = sw * fit * mo.scale;
    const h = sh * fit * mo.scale;
    const r = (mo.rotation * Math.PI) / 180;
    const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
    const bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
    const cx = W / 2 + mo.x * W;
    const cy = H / 2 + mo.y * H;
    return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
  };
  const p = box(a, am, a.duration);
  const q = box(b, bm, 0);
  const x0 = Math.min(W - 2, Math.max(0, Math.floor(Math.min(p[0], q[0]))));
  const y0 = Math.min(H - 2, Math.max(0, Math.floor(Math.min(p[1], q[1]))));
  const x1 = Math.max(x0 + 2, Math.min(W, Math.ceil(Math.max(p[2], q[2]))));
  const y1 = Math.max(y0 + 2, Math.min(H, Math.ceil(Math.max(p[3], q[3]))));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
