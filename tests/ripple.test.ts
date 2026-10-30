import { describe, expect, it } from "vitest";
import { clipEnd, clipFromMedia, newProject, newTrack, rippleDelete, textClip } from "../src/core/timeline";
import type { Clip, MediaItem, Project } from "../src/core/types";
import { mergeRanges } from "../src/editor/silence";

const video: MediaItem = { id: "v", kind: "video", path: "C:\\v.mp4", name: "v.mp4", duration: 30, width: 1920, height: 1080, fps: 30, hasAudio: true };
const image: MediaItem = { id: "i", kind: "image", path: "C:\\i.png", name: "i.png", duration: 0, width: 800, height: 600, fps: 0, hasAudio: false };

function setup(): Project {
  const v: Clip = { ...clipFromMedia(video, 0), id: "v", duration: 10, transition: { id: "fade", duration: 0.5 }, keyframes: { x: [{ t: 1, v: 0, ease: "linear" }, { t: 7, v: 0.5, ease: "linear" }] } };
  const v2: Clip = { ...clipFromMedia(video, 10), id: "v2", in: 10, duration: 5 };
  const img: Clip = { ...clipFromMedia(image, 2), id: "img", duration: 6 };
  const cap1: Clip = { ...textClip(3, "앞"), id: "cap1", duration: 1 };
  const cap2: Clip = { ...textClip(4.5, "걸침"), id: "cap2", duration: 2.5 };
  const cap3: Clip = { ...textClip(4.2, "안"), id: "cap3", duration: 1.5 };
  const late: Clip = { ...textClip(8, "뒤"), id: "late", duration: 1 };
  const capX: Clip = { ...textClip(3.5, "자막 걸침"), id: "capX", duration: 3, caption: true };
  const p = newProject();
  return {
    ...p,
    media: [video, image],
    tracks: [{ ...newTrack("text"), clips: [cap1, cap2, late] }, { ...newTrack("text"), clips: [cap3, capX] }, { ...newTrack("video"), clips: [img] }, { ...p.tracks[0], clips: [v, v2] }],
  };
}
const byId = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);

describe("구간 잘라내고 당겨 붙이기", () => {
  const p = rippleDelete(setup(), 4, 6);

  it("걸친 메인 클립은 둘로 나뉘고 뒷부분의 원본 위치·키프레임이 따라간다", () => {
    const main = p.tracks.find((t) => t.main)!.clips.sort((a, b) => a.start - b.start);
    expect(main.map((c) => [c.start, c.duration])).toEqual([[0, 4], [4, 4], [8, 5]]);
    const [left, right, v2] = main;
    expect(left.transition).toBeUndefined(); // 같은 원본이 이어지는 자리에는 전환 없음
    expect(right.in).toBe(6);
    expect(right.keyframes!.x!.map((k) => k.t)).toEqual([-5, 1]);
    expect(v2.id).toBe("v2");
    expect(v2.in).toBe(10);
  });

  it("완전히 안에 든 클립은 없어지고, 뒤 클립은 당겨진다", () => {
    expect(byId(p, "cap3")).toBeUndefined();
    expect(byId(p, "cap1")).toMatchObject({ start: 3, duration: 1 });
    expect(byId(p, "late")).toMatchObject({ start: 6, duration: 1 });
  });

  it("무음에 걸친 자막은 말이 끝난 자리에서 끝나고 뒷조각이 남지 않는다", () => {
    expect(byId(p, "capX")).toMatchObject({ start: 3.5, duration: 0.5 });
    expect(p.tracks[1].clips).toHaveLength(1);
  });

  it("앞이 잘린 자막은 같은 아이디로 남고 길이만 줄어든다", () => {
    const cap2 = byId(p, "cap2")!;
    expect(cap2.start).toBe(4);
    expect(cap2.duration).toBeCloseTo(1);
    expect(byId(p, "img")).toMatchObject({ start: 2, duration: 2 });
    const imgRight = p.tracks[2].clips.find((c) => c.id !== "img")!;
    expect([imgRight.start, clipEnd(imgRight)]).toEqual([4, 6]);
  });

  it("두 구간을 뒤에서부터 자르면 앞 시각이 밀리지 않는다", () => {
    const q = [{ a: 1, b: 2 }, { a: 4, b: 6 }].reverse().reduce((acc, r) => rippleDelete(acc, r.a, r.b), setup());
    expect(byId(q, "late")).toMatchObject({ start: 5 });
    expect(byId(q, "v2")).toMatchObject({ start: 7 });
  });
});

describe("구간 합치기", () => {
  it("겹치거나 붙은 구간은 하나로", () => {
    expect(mergeRanges([{ a: 5, b: 6 }, { a: 1, b: 2 }, { a: 1.5, b: 3 }, { a: 3, b: 4 }])).toEqual([{ a: 1, b: 4 }, { a: 5, b: 6 }]);
  });
});
