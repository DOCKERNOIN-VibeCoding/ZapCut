import { beforeEach, describe, expect, it } from "vitest";
import { clipFromMedia, newProject, placeClip } from "../src/core/timeline";
import type { MediaItem } from "../src/core/types";
import { useEditor } from "../src/editor/store";

// 속성 패널의 일괄 적용: 여러 클립 id를 한 번에 넘기면 전부 바뀐다
const mv: MediaItem = { id: "m", kind: "video", path: "v.mp4", name: "v.mp4", duration: 10, width: 320, height: 180, fps: 30, hasAudio: true };

describe("여러 클립 일괄 편집", () => {
  let a = "";
  let b = "";
  beforeEach(() => {
    let p = { ...newProject(), media: [mv] };
    const ca = clipFromMedia(mv, 0);
    const cb = { ...clipFromMedia(mv, 4), duration: 4 };
    p = placeClip(p, ca, p.tracks[0].id);
    p = placeClip(p, cb, p.tracks[0].id);
    useEditor.getState().load(p);
    a = ca.id;
    b = cb.id;
  });
  const clips = () => useEditor.getState().project.tracks[0].clips;

  it("배속을 두 클립에 한 번에", () => {
    useEditor.getState().changeSpeed([a, b], 2);
    expect(clips().map((c) => c.speed)).toEqual([2, 2]);
    expect(clips().map((c) => c.duration)).toEqual([5, 2]); // 원본 10초·4초 → 절반
    useEditor.getState().undo();
    expect(clips().map((c) => c.speed)).toEqual([1, 1]);
  });

  it("크기·불투명도를 두 클립에 한 번에 (키프레임 없는 속성은 기본값이 바뀐다)", () => {
    useEditor.getState().setClipProps([a, b], { scale: 0.5, opacity: 0.3 });
    for (const c of clips()) {
      expect(c.transform.scale).toBe(0.5);
      expect(c.transform.opacity).toBe(0.3);
    }
  });

  it("id 하나만 넘기면 그 클립만", () => {
    useEditor.getState().setClipProps(a, { scale: 0.5 });
    expect(clips().map((c) => c.transform.scale)).toEqual([0.5, 1]);
  });
});
