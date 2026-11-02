// 포맷 변환(reframe): 캔버스 비율을 바꾸고 메인 트랙의 영상·사진을 새 비율에 맞게 자른다 (16:9 롱폼 → 9:16 숏폼 등).
// 자르기는 clip.crop으로만 하므로 위치·크기 키프레임과 충돌하지 않고, 미리보기·내보내기가 같은 규칙(placement)으로 그린다.
// 얼굴 찾기와 텍스트 폭 재기는 화면이 필요하므로 editor 레이어(src/editor/reframe.ts)가 해서 넘긴다.
import { DEFAULT_CANVAS, DEFAULT_CROP, type Clip, type Crop, type MediaItem, type Project } from "./types";

export type ReframeFit = "fill" | "box";
export interface ReframeOptions {
  width: number;
  height: number;
  fit: ReframeFit; // fill: 새 비율로 잘라 화면을 가득 채움 / box: 1:1까지만 잘라 남는 위아래(또는 양옆)는 비움
  blur: boolean; // box에서 빈 곳을 흐린 원본으로 채움 (아니면 배경색)
}
/** 자를 때 가운데에 둘 점 (원본 크기 비율 0..1). 얼굴 기준이면 얼굴 중심 */
export interface Anchor {
  x: number;
  y: number;
}
export interface ReframeInput {
  anchors?: Record<string, Anchor>; // clip id → 기준점 (없으면 가운데)
  /** 텍스트·타이틀 클립의 자연 폭(px, 캔버스 높이 Href 기준). 새 캔버스 폭의 90%를 넘으면 그만큼 줄인다 */
  measure?: (c: Clip, Href: number) => number | undefined;
}
export interface ReframeResult {
  project: Project;
  cropped: number; // 더 잘린 클립 수
  boxed: number; // 빈 곳이 생긴 클립 수
  shrunk: number; // 줄인 텍스트·타이틀 수
}

export const TEXT_MAX_WIDTH = 0.9;

const median3 = (a: number, b: number, c: number) => a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** 변환 대상: 메인 트랙의 영상·사진 (스티커 제외) */
export function reframeTargets(p: Project): { clip: Clip; media: MediaItem }[] {
  const out: { clip: Clip; media: MediaItem }[] = [];
  for (const t of p.tracks) {
    if (!t.main) continue;
    for (const clip of t.clips) {
      if (clip.kind !== "video" && clip.kind !== "image") continue;
      const media = p.media.find((m) => m.id === clip.mediaId);
      if (media && !media.sticker && media.width > 0 && media.height > 0) out.push({ clip, media });
    }
  }
  return out;
}

/** 지금 자른 상태의 원본 비율 */
export function sourceAspect(c: Clip, m: MediaItem) {
  const cr = c.crop ?? DEFAULT_CROP;
  return ((1 - cr.l - cr.r) * m.width) / ((1 - cr.t - cr.b) * m.height);
}

/** 자른 뒤의 비율. fill은 대상 비율, box는 원본·대상·1:1의 중간값 (16:9→9:16이면 1:1, 3:4→9:16이면 그대로, 대상이 1:1이면 fill과 같다) */
export function cropAspect(src: number, target: number, fit: ReframeFit) {
  return fit === "fill" ? target : median3(src, target, 1);
}

/** 지금 자른 영역 안에서 비율이 aspect가 되도록 더 자른다. anchor(원본 비율 좌표)를 가운데에 두되 영역을 벗어나지 않는다. 바꿀 게 없으면 기존 crop 객체를 그대로 돌려준다 */
export function cropTo(c: Clip, m: MediaItem, aspect: number, anchor?: Anchor): Crop {
  const cr = c.crop ?? DEFAULT_CROP;
  const rx = cr.l * m.width;
  const ry = cr.t * m.height;
  const rw = (1 - cr.l - cr.r) * m.width;
  const rh = (1 - cr.t - cr.b) * m.height;
  const ax = (anchor?.x ?? 0.5) * m.width;
  const ay = (anchor?.y ?? 0.5) * m.height;
  if (rw / rh > aspect * (1 + 1e-6)) {
    const cw = rh * aspect;
    const x0 = clamp(ax - cw / 2, rx, rx + rw - cw);
    return { ...cr, l: r4(x0 / m.width), r: r4(1 - (x0 + cw) / m.width) };
  }
  if (rw / rh < aspect * (1 - 1e-6)) {
    const ch = rw / aspect;
    const y0 = clamp(ay - ch / 2, ry, ry + rh - ch);
    return { ...cr, t: r4(y0 / m.height), b: r4(1 - (y0 + ch) / m.height) };
  }
  return cr;
}

function scaleClip(c: Clip, f: number): Clip {
  const kf = c.keyframes?.scale;
  return {
    ...c,
    transform: { ...c.transform, scale: c.transform.scale * f },
    keyframes: kf ? { ...c.keyframes, scale: kf.map((k) => ({ ...k, v: k.v * f })) } : c.keyframes,
  };
}

export function reframeProject(p: Project, o: ReframeOptions, input: ReframeInput = {}): ReframeResult {
  const target = o.width / o.height;
  const targets = new Map(reframeTargets(p).map((t) => [t.clip.id, t.media]));
  let cropped = 0;
  let boxed = 0;
  let shrunk = 0;
  const tracks = p.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c) => {
      const m = targets.get(c.id);
      if (m) {
        const aspect = cropAspect(sourceAspect(c, m), target, o.fit);
        const cr = c.crop ?? DEFAULT_CROP;
        const crop = cropTo(c, m, aspect, input.anchors?.[c.id]);
        let next = c;
        if (crop !== cr) {
          cropped++;
          next = { ...next, crop };
        }
        if (Math.abs(aspect - target) > 1e-3) {
          boxed++;
          if (o.blur) next = { ...next, canvas: { ...(c.canvas ?? DEFAULT_CANVAS), type: "blur" } };
          else if (c.canvas?.type === "blur") next = { ...next, canvas: { ...c.canvas, type: "none" } };
        }
        return next;
      }
      if (c.kind === "text" && input.measure) {
        const w = input.measure(c, o.height);
        const f = w ? (TEXT_MAX_WIDTH * o.width) / (w * c.transform.scale) : 1;
        if (f < 1) {
          shrunk++;
          return scaleClip(c, f);
        }
      }
      return c;
    }),
  }));
  const project: Project = { ...p, width: o.width, height: o.height, tracks };
  delete project.fitFirstMedia;
  return { project, cropped, boxed, shrunk };
}
