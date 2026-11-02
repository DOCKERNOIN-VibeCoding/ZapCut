import { describe, expect, it } from "vitest";
import { cropAspect, cropTo, reframeProject, reframeTargets } from "../src/core/reframe";
import { clipFromMedia, newProject, placeClip, textClip } from "../src/core/timeline";
import type { Clip, MediaItem, Project } from "../src/core/types";

const wide: MediaItem = { id: "w", kind: "video", path: "w.mp4", name: "wide.mp4", duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true };
const tall: MediaItem = { id: "t", kind: "video", path: "t.mp4", name: "tall.mp4", duration: 10, width: 1080, height: 1920, fps: 30, hasAudio: true };
const square: MediaItem = { id: "s", kind: "image", path: "s.png", name: "square.png", duration: 0, width: 1000, height: 1000, fps: 0, hasAudio: false };
const sticker: MediaItem = { ...square, id: "k", name: "sticker", sticker: true };

const PORTRAIT = { width: 1080, height: 1920 };
const aspectOf = (c: Clip, m: MediaItem) => {
  const cr = c.crop!;
  return ((1 - cr.l - cr.r) * m.width) / ((1 - cr.t - cr.b) * m.height);
};

describe("포맷 변환: 자를 비율", () => {
  it("꽉 채우기는 대상 비율, 1:1 자르기는 원본·대상·1:1의 중간값", () => {
    expect(cropAspect(16 / 9, 9 / 16, "fill")).toBeCloseTo(9 / 16);
    expect(cropAspect(16 / 9, 9 / 16, "box")).toBe(1); // 16:9 → 9:16: 1:1로 자르고 위아래 비움
    expect(cropAspect(3 / 4, 9 / 16, "box")).toBeCloseTo(3 / 4); // 이미 1:1보다 세로로 길면 그대로
    expect(cropAspect(16 / 9, 4 / 3, "box")).toBeCloseTo(4 / 3); // 대상이 가로형이면 꽉 채우기와 같다
    expect(cropAspect(9 / 16, 16 / 9, "box")).toBe(1); // 세로 → 가로: 1:1로 자르고 양옆 비움
    expect(cropAspect(16 / 9, 1, "box")).toBe(1);
  });
});

describe("포맷 변환: 자르기", () => {
  const clip = clipFromMedia(wide, 0);
  it("가운데 기준으로 양옆을 잘라 9:16", () => {
    const cr = cropTo(clip, wide, 9 / 16);
    expect(cr.l).toBeCloseTo(0.3418, 4);
    expect(cr.r).toBeCloseTo(0.3418, 4);
    expect(cr.t).toBe(0);
    expect(aspectOf({ ...clip, crop: cr }, wide)).toBeCloseTo(9 / 16, 3);
  });
  it("얼굴 기준이면 그 점을 가운데에 두고, 가장자리에서는 영역 안에 머문다", () => {
    const left = cropTo(clip, wide, 9 / 16, { x: 0.2, y: 0.5 });
    expect(left.l).toBeCloseTo(0.0418, 4); // 384 - 607.5/2 = 80.25px
    expect(left.r).toBeCloseTo(0.6418, 4);
    const edge = cropTo(clip, wide, 9 / 16, { x: 0.95, y: 0.5 });
    expect(edge.r).toBe(0);
    expect(edge.l).toBeCloseTo(0.6836, 4);
  });
  it("이미 자른 영역 안에서만 더 자른다", () => {
    const pre = { ...clip, crop: { l: 0.1, t: 0, r: 0.1, b: 0 } };
    const cr = cropTo(pre, wide, 1, { x: 0, y: 0.5 });
    expect(cr.l).toBeCloseTo(0.1, 4);
    expect(aspectOf({ ...pre, crop: cr }, wide)).toBeCloseTo(1, 3);
  });
  it("세로 원본을 가로로 만들면 위아래를 자른다", () => {
    const cr = cropTo(clipFromMedia(tall, 0), tall, 16 / 9);
    expect(cr.l).toBe(0);
    expect(cr.t).toBeCloseTo(0.3418, 4);
    expect(cr.b).toBeCloseTo(0.3418, 4);
  });
  it("비율이 이미 맞으면 기존 crop 객체를 그대로 돌려준다", () => {
    const sq = clipFromMedia(square, 0);
    expect(cropTo(sq, square, 1)).toBe(sq.crop ?? cropTo(sq, square, 1));
  });
});

describe("포맷 변환: 프로젝트", () => {
  function setup() {
    let p: Project = { ...newProject(), fitFirstMedia: true, media: [wide, square, sticker] };
    const main = p.tracks[0].id;
    const v = clipFromMedia(wide, 0);
    const st = { ...clipFromMedia(sticker, 10), duration: 3 };
    const over = { ...clipFromMedia(wide, 2), duration: 3 }; // 메인 위에 겹친 PIP
    const txt = textClip(1, "엽떡매니아");
    p = placeClip(p, v, main);
    p = placeClip(p, st, main);
    p = placeClip(p, over);
    p = placeClip(p, txt);
    return { p, v, st, over, txt };
  }
  const find = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;

  it("대상은 메인 트랙의 영상·사진이고 스티커는 뺀다", () => {
    const { p, v } = setup();
    expect(reframeTargets(p).map((t) => t.clip.id)).toEqual([v.id]);
  });

  it("1:1 자르기 + 블러: 메인 클립만 잘리고 빈 곳은 흐린 배경, 겹친 클립은 그대로", () => {
    const { p, v, over, st } = setup();
    const r = reframeProject(p, { ...PORTRAIT, fit: "box", blur: true });
    expect(r.project.width).toBe(1080);
    expect(r.project.height).toBe(1920);
    expect(r.project.fitFirstMedia).toBeUndefined();
    expect(r.cropped).toBe(1);
    expect(r.boxed).toBe(1);
    const c = find(r.project, v.id);
    expect(c.crop!.l).toBeCloseTo(0.2188, 4);
    expect(c.crop!.r).toBeCloseTo(0.2188, 4);
    expect(c.canvas?.type).toBe("blur");
    expect(find(r.project, over.id).crop).toBeUndefined();
    expect(find(r.project, st.id).crop).toBeUndefined();
  });

  it("블러를 끄면 배경색(canvas 없음), 꽉 채우기는 9:16으로 잘라 빈 곳이 없다", () => {
    const { p, v } = setup();
    const noBlur = reframeProject(p, { ...PORTRAIT, fit: "box", blur: false });
    expect(find(noBlur.project, v.id).canvas).toBeUndefined();
    const fill = reframeProject(p, { ...PORTRAIT, fit: "fill", blur: true });
    expect(fill.boxed).toBe(0);
    const c = find(fill.project, v.id);
    expect(c.crop!.l).toBeCloseTo(0.3418, 4);
    expect(c.canvas).toBeUndefined();
  });

  it("얼굴 기준점을 넘기면 그 클립만 그 점을 가운데에 둔다", () => {
    const { p, v } = setup();
    const r = reframeProject(p, { ...PORTRAIT, fit: "fill", blur: false }, { anchors: { [v.id]: { x: 0.2, y: 0.5 } } });
    expect(find(r.project, v.id).crop!.l).toBeCloseTo(0.0418, 4);
  });

  it("텍스트·타이틀은 새 캔버스 폭의 90%를 넘으면 줄인다 (크기 키프레임도 같이)", () => {
    const { p, txt } = setup();
    const withKf = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === txt.id ? { ...c, keyframes: { scale: [{ t: 0, v: 1, ease: "linear" as const }, { t: 1, v: 2, ease: "linear" as const }] } } : c)) })) };
    const r = reframeProject(withKf, { ...PORTRAIT, fit: "fill", blur: false }, { measure: () => 2000 });
    expect(r.shrunk).toBe(1);
    const c = find(r.project, txt.id);
    expect(c.transform.scale).toBeCloseTo((0.9 * 1080) / 2000, 5);
    expect(c.keyframes!.scale!.map((k) => k.v)).toEqual([(0.9 * 1080) / 2000, (2 * 0.9 * 1080) / 2000]);
    const fits = reframeProject(p, { ...PORTRAIT, fit: "fill", blur: false }, { measure: () => 500 });
    expect(fits.shrunk).toBe(0);
    expect(find(fits.project, txt.id).transform.scale).toBe(1);
  });

  it("1:1 원본을 9:16으로: 꽉 채우기는 양옆을 자르고, 1:1 자르기는 자르지 않고 위아래만 비운다", () => {
    let p: Project = { ...newProject(), media: [square] };
    const c = clipFromMedia(square, 0);
    p = placeClip(p, { ...c, duration: 3 }, p.tracks[0].id);
    const fill = reframeProject(p, { ...PORTRAIT, fit: "fill", blur: true });
    expect(find(fill.project, c.id).crop!.l).toBeCloseTo(0.2188, 4);
    const box = reframeProject(p, { ...PORTRAIT, fit: "box", blur: true });
    expect(box.cropped).toBe(0);
    expect(box.boxed).toBe(1);
    expect(find(box.project, c.id).canvas?.type).toBe("blur");
  });
});
