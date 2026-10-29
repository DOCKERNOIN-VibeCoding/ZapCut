// 시간 t의 화면 구성 계산 (내보내기 그래프와 같은 규칙)
import { motionAt, type MotionValues } from "../core/motion";
import { clipEnd } from "../core/timeline";
import { findTransition } from "../core/transitions";
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

export type FrameItem = { type: "layer"; layer: LayerDraw } | { type: "effect" | "adjust"; clip: Clip; T: number };

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

/** 메인 트랙 전환 길이 (내보내기 buildMainTrack과 같은 규칙) */
export function mainTransitions(track: Track) {
  const clips = track.clips.filter((c) => c.kind === "video" || c.kind === "image").sort((a, b) => a.start - b.start);
  return clips.map((cl, i) => {
    const next = clips[i + 1];
    const def = findTransition(cl.transition?.id);
    if (!def || !next || Math.abs(next.start - clipEnd(cl)) > 0.01) return undefined;
    return { a: cl, b: next, def, d: Math.min(cl.transition!.duration, cl.duration * 0.9, next.duration * 0.9), cut: clipEnd(cl) };
  });
}

function mainAt(p: Project, track: Track, t: number): MainDraw {
  for (const tr of mainTransitions(track)) {
    if (!tr) continue;
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
    for (const clip of track.clips) {
      if (t < clip.start || t >= clipEnd(clip) || clip.kind === "audio") continue;
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
