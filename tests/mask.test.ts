import { describe, expect, it } from "vitest";
import { compile } from "../src/core/expr";
import { maskAt, maskExpr } from "../src/core/mask";
import { keyframeValue } from "../src/core/motion";
import { clipFromMedia, newProject, placeClip, splitClip, trimClip } from "../src/core/timeline";
import { DEFAULT_MASK, type Clip, type MediaItem } from "../src/core/types";

const media: MediaItem = { id: "m", kind: "video", path: "C:\\v.mp4", name: "v.mp4", duration: 20, width: 1920, height: 1080, fps: 30, hasAudio: false };

function moving(): Clip {
  return {
    ...clipFromMedia(media, 0),
    duration: 10,
    mask: { ...DEFAULT_MASK, type: "rect", w: 0.2, h: 0.2 },
    keyframes: {
      maskX: [{ t: 0, v: -0.3, ease: "linear" }, { t: 10, v: 0.3, ease: "linear" }],
      maskW: [{ t: 2, v: 0.1, ease: "easeInOut" }, { t: 6, v: 0.4, ease: "linear" }],
      x: [{ t: 1, v: 0, ease: "linear" }, { t: 9, v: 0.5, ease: "linear" }],
    },
  };
}

describe("마스크 키프레임", () => {
  it("내보내기 수식(시간 T)과 미리보기 계산이 같은 마스크를 만든다", () => {
    const c = moving();
    const animated = compile(maskExpr(c.mask!, c.keyframes));
    for (const T of [0, 1.5, 4, 7.25, 10]) {
      const still = compile(maskExpr(maskAt(c, T)));
      for (const [X, Y] of [[100, 100], [700, 540], [960, 540], [1500, 300]]) {
        const v = { X, Y, W: 1920, H: 1080, T };
        expect(animated(v), `T=${T} (${X},${Y})`).toBeCloseTo(still(v), 6);
      }
    }
  });

  it("마스크가 움직인다 (왼쪽 → 오른쪽)", () => {
    const f = compile(maskExpr(moving().mask!, moving().keyframes));
    expect(f({ X: 960 - 0.3 * 1920, Y: 540, W: 1920, H: 1080, T: 0 })).toBeGreaterThan(0.9);
    expect(f({ X: 960 + 0.3 * 1920, Y: 540, W: 1920, H: 1080, T: 0 })).toBeLessThan(0.1);
    expect(f({ X: 960 + 0.3 * 1920, Y: 540, W: 1920, H: 1080, T: 10 })).toBeGreaterThan(0.9);
  });
});

describe("자르기·분할 후에도 키프레임이 같은 시각에", () => {
  const valueAtTimeline = (c: Clip, prop: "x" | "maskX" | "maskW", base: number, t: number) => keyframeValue(c.keyframes?.[prop], base, t - c.start);

  it("분할: 오른쪽 클립의 값이 원래 클립과 같다", () => {
    let p = placeClip(newProject(), moving(), undefined, true);
    const id = p.tracks.find((t) => t.clips.length)!.clips[0].id;
    const before = p.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
    const [after, rightId] = splitClip(p, id, 4);
    p = after;
    const right = p.tracks.flatMap((t) => t.clips).find((c) => c.id === rightId)!;
    for (const t of [4, 5.5, 8, 9.9]) {
      expect(valueAtTimeline(right, "maskX", 0, t)).toBeCloseTo(valueAtTimeline(before, "maskX", 0, t), 6);
      expect(valueAtTimeline(right, "maskW", 0.2, t)).toBeCloseTo(valueAtTimeline(before, "maskW", 0.2, t), 6);
      expect(valueAtTimeline(right, "x", 0, t)).toBeCloseTo(valueAtTimeline(before, "x", 0, t), 6);
    }
  });

  it("왼쪽 자르기: 남은 구간의 값이 그대로다", () => {
    const p = placeClip(newProject(), { ...moving(), start: 5, in: 5 }, undefined, true);
    const before = p.tracks.flatMap((t) => t.clips)[0];
    const trimmed = trimClip(p, before.id, "left", 7).tracks.flatMap((t) => t.clips)[0];
    expect(trimmed.start).toBe(7);
    for (const t of [7, 9, 12]) expect(valueAtTimeline(trimmed, "maskX", 0, t)).toBeCloseTo(valueAtTimeline(before, "maskX", 0, t), 6);
  });
});
