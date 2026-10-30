import { describe, expect, it } from "vitest";
import { compile } from "../src/core/expr";
import { keyframeExpr } from "../src/core/motion";
import { placement, toCanvas, toSource } from "../src/core/placement";
import { clipFromMedia, newProject } from "../src/core/timeline";
import { DEFAULT_MASK, DEFAULT_TRANSFORM, type Clip, type MediaItem } from "../src/core/types";
import { regionKeys } from "../src/editor/tracking";

const media: MediaItem = { id: "m", kind: "video", path: "C:\\v.mp4", name: "v.mp4", duration: 20, width: 1280, height: 720, fps: 30, hasAudio: false };

describe("캔버스 ↔ 원본 좌표", () => {
  it("크기·위치·자르기·뒤집기를 거쳐도 왕복하면 제자리", () => {
    const c: Clip = { ...clipFromMedia(media, 0), transform: { ...DEFAULT_TRANSFORM, scale: 0.6, x: 0.1, y: -0.05 }, crop: { l: 0.1, t: 0.05, r: 0.2, b: 0 }, flipH: true };
    const pl = placement(c, media, 0, 1920, 1080);
    for (const [x, y] of [[200, 100], [640, 360], [1000, 600]]) {
      const C = toCanvas(pl, x, y);
      const back = toSource(pl, C.X, C.Y);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it("화면을 꽉 채운 1280×720 영상은 1.5배", () => {
    const pl = placement(clipFromMedia(media, 0), media, 0, 1920, 1080);
    expect(toCanvas(pl, 640, 360)).toEqual({ X: 960, Y: 540 });
    expect(pl.k).toBeCloseTo(1.5);
  });
});

describe("추적 결과 → 영역 키프레임", () => {
  it("곧게 움직인 상자는 처음·끝 두 키로 줄고, 값은 화면 좌표", () => {
    const p = newProject();
    const video = clipFromMedia(media, 0);
    const region: Clip = { ...clipFromMedia(media, 1), kind: "effect", mediaId: undefined, duration: 5, mask: { ...DEFAULT_MASK, type: "rect" } };
    // 원본에서 왼쪽 → 오른쪽, 크기 고정 (15프레임/초 × 2초)
    const boxes = Array.from({ length: 31 }, (_, i) => ({ x: 0.1 + i * 0.01, y: 0.4, w: 0.1, h: 0.2 }));
    const keys = regionKeys(p, region, video, media, 2, boxes);
    expect(keys.maskX!.length).toBeLessThanOrEqual(4);
    const x = compile(keyframeExpr(keys.maskX, 0));
    // t=2(영역 클립 안 1초): 상자 중심 0.15 → 화면 비율 0.15 - 0.5
    expect(x({ T: 1 })).toBeCloseTo(-0.35, 2);
    expect(x({ T: 3 })).toBeCloseTo(0.45 - 0.5, 2);
    // 크기: 원본 폭 10% = 128px → 화면 192px / 짧은 변 1080
    expect(compile(keyframeExpr(keys.maskW, 0))({ T: 2 })).toBeCloseTo(192 / 1080, 3);
  });
});
