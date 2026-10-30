// 시간 t의 화면 구성 계산 (내보내기 그래프와 같은 규칙)
import { motionAt, type MotionValues } from "../core/motion";
import { clipEnd } from "../core/timeline";
import { trackTransitions } from "../core/transitions";
import type { Clip, MediaItem, Project, Track } from "../core/types";

export interface LayerDraw {
  clip: Clip;
  T: number; // 클립 내부 시간 (전환 여유 구간이면 범위를 벗어날 수 있음)
  media?: MediaItem;
  m: MotionValues;
}

export type MainDraw =
  | { type: "single"; layer: LayerDraw }
  | { type: "transition"; a: LayerDraw; b: LayerDraw; kind: number; p: number }
  | null;

export type FrameItem =
  | { type: "layer"; layer: LayerDraw }
  | { type: "effect" | "adjust"; clip: Clip; T: number }
  | { type: "transition"; a: LayerDraw; b: LayerDraw; kind: number; p: number }; // 오버레이 트랙 전환

export interface Frame {
  main: MainDraw;
  items: FrameItem[]; // 메인 위쪽, 아래 → 위 순서
  layers: LayerDraw[]; // 화면에 그려지는 모든 레이어 (선택 상자 계산용)
}

const layerFor = (p: Project, clip: Clip, T: number): LayerDraw => ({
  clip,
  T,
  media: clip.mediaId ? p.media.find((m) => m.id === clip.mediaId) : undefined,
  m: motionAt(clip, T),
});

function mainAt(p: Project, track: Track, t: number): MainDraw {
  for (const tr of trackTransitions(track)) {
    const s = tr.cut - tr.d / 2;
    if (t >= s && t < tr.cut + tr.d / 2) {
      return { type: "transition", a: layerFor(p, tr.a, t - tr.a.start), b: layerFor(p, tr.b, t - tr.b.start), kind: tr.def.kind, p: (t - s) / tr.d };
    }
  }
  const clip = track.clips.find((c) => (c.kind === "video" || c.kind === "image") && t >= c.start && t < clipEnd(c));
  return clip ? { type: "single", layer: layerFor(p, clip, t - clip.start) } : null;
}

export function frameAt(p: Project, t: number): Frame {
  const frame: Frame = { main: null, items: [], layers: [] };
  const visual = p.tracks.filter((tr) => tr.kind !== "audio" && !tr.hidden);
  for (let i = visual.length - 1; i >= 0; i--) {
    const track = visual[i];
    if (track.main) {
      frame.main = mainAt(p, track, t);
      if (frame.main?.type === "single") frame.layers.push(frame.main.layer);
      else if (frame.main?.type === "transition") frame.layers.push(frame.main.a, frame.main.b);
      continue;
    }
    // 전환 구간에는 두 클립 대신 전환 항목 하나를 그린다
    const trs = trackTransitions(track);
    const tr = trs.find((x) => t >= x.cut - x.d / 2 && t < x.cut + x.d / 2);
    if (tr) {
      const a = layerFor(p, tr.a, t - tr.a.start);
      const b = layerFor(p, tr.b, t - tr.b.start);
      frame.items.push({ type: "transition", a, b, kind: tr.def.kind, p: (t - (tr.cut - tr.d / 2)) / tr.d });
      frame.layers.push(a, b);
    }
    for (const clip of track.clips) {
      if (t < clip.start || t >= clipEnd(clip) || clip.kind === "audio") continue;
      if (trs.some((x) => (x.a === clip && t >= x.cut - x.d / 2) || (x.b === clip && t < x.cut + x.d / 2))) continue;
      const T = t - clip.start;
      if (clip.kind === "effect" || clip.kind === "adjust") frame.items.push({ type: clip.kind, clip, T });
      else {
        const layer = layerFor(p, clip, T);
        frame.items.push({ type: "layer", layer });
        frame.layers.push(layer);
      }
    }
  }
  return frame;
}
