import { describe, expect, it, vi } from "vitest";
import { clipFromMedia, newProject, newTrack, placeClip } from "../src/core/timeline";
import type { MediaItem, Project } from "../src/core/types";
import { useEditor } from "../src/editor/store";

const mv: MediaItem = { id: "m", kind: "video", path: "v.mp4", name: "v.mp4", duration: 10, width: 320, height: 180, fps: 30, hasAudio: false };

/** 메인 트랙(잠금 안 함)에 a, 잠긴 오버레이 트랙에 b */
function setup() {
  let p: Project = { ...newProject(), media: [mv] };
  const a = clipFromMedia(mv, 0);
  const b = clipFromMedia(mv, 2);
  p = placeClip(p, a, p.tracks[0].id);
  const locked = { ...newTrack("video"), locked: true, clips: [b] };
  p = { ...p, tracks: [locked, ...p.tracks] };
  useEditor.getState().load(p);
  return { a: a.id, b: b.id };
}
const ids = () => useEditor.getState().project.tracks.flatMap((t) => t.clips.map((c) => c.id));

describe("잠긴 트랙", () => {
  it("선택 삭제는 잠긴 트랙의 클립을 남긴다", () => {
    const { a, b } = setup();
    useEditor.getState().select([a, b]);
    useEditor.getState().deleteSelected();
    expect(ids()).toEqual([b]);
    expect(useEditor.getState().selection).toEqual([b]);
  });

  it("선택 분할·Q/W도 잠긴 트랙의 클립은 건드리지 않는다", () => {
    const { a, b } = setup();
    useEditor.getState().setPlayhead(5);
    useEditor.getState().select([a, b]);
    useEditor.getState().splitAtPlayhead();
    expect(ids().filter((id) => id === b)).toHaveLength(1);
    expect(useEditor.getState().project.tracks[0].clips).toHaveLength(1);
    useEditor.getState().select([b]);
    useEditor.getState().trimSide("right");
    expect(useEditor.getState().project.tracks[0].clips[0].duration).toBe(10);
  });
});

describe("실행 취소와 선택", () => {
  it("되돌려서 없어진 클립은 선택에서 빠진다", () => {
    const { a } = setup();
    useEditor.getState().select([a]);
    useEditor.getState().copy();
    useEditor.getState().setPlayhead(20);
    useEditor.getState().paste();
    const pasted = useEditor.getState().selection;
    expect(pasted).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().selection).toEqual([]);
  });
});

describe("사진 크기 바로잡기", () => {
  it("열 때 사진을 다시 읽어 가로·세로가 바뀌었으면 고친다", async () => {
    const photo: MediaItem = { id: "p", kind: "image", path: "phone.jpg", name: "phone.jpg", duration: 0, width: 1920, height: 1080, fps: 30, hasAudio: false };
    vi.stubGlobal("window", { zapcut: { probeMedia: async () => ({ ...photo, width: 1080, height: 1920 }) } });
    useEditor.getState().load({ ...newProject(), media: [photo] });
    await vi.waitFor(() => expect(useEditor.getState().project.media[0]).toMatchObject({ width: 1080, height: 1920 }));
    vi.unstubAllGlobals();
  });
});
