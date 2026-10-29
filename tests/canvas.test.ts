import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildExportPlan } from "../src/core/exportPlan";
import { canvasSize, clipFromMedia, newProject, placeClip } from "../src/core/timeline";
import type { MediaItem } from "../src/core/types";

const hd = (id: string): MediaItem => ({ id, kind: "video", path: `C:\\v\\${id}.mp4`, name: `${id}.mp4`, duration: 5, width: 1920, height: 1080, fps: 30, hasAudio: false });

describe("캔버스 크기", () => {
  it("해상도 등급은 짧은 변이다", () => {
    expect(canvasSize(16, 9, 2160)).toEqual({ width: 3840, height: 2160 });
    expect(canvasSize(9, 16, 2160)).toEqual({ width: 2160, height: 3840 });
    expect(canvasSize(21, 9, 1080)).toEqual({ width: 2520, height: 1080 });
    expect(canvasSize(1, 1, 720)).toEqual({ width: 720, height: 720 });
    // 소스 크기를 그대로 비율로 쓸 때도 짝수
    expect(canvasSize(604, 1080, 1080)).toEqual({ width: 1080, height: 1932 });
  });

  it("4K 캔버스에 1080p 소스를 50%로 놓으면 원본 크기 그대로 들어간다", () => {
    const m = hd("a");
    let p = { ...newProject(undefined, canvasSize(16, 9, 2160)), media: [m] };
    const c = clipFromMedia(m, 0);
    p = placeClip(p, { ...c, transform: { ...c.transform, scale: 0.5, x: -0.25, y: -0.25 } }, p.tracks[0].id);
    const plan = buildExportPlan(p, { height: 2160, fps: 30, quality: "high", encoder: "libx264", format: "mp4" }, { text: {} }, "C:\\out.mp4");
    expect(plan.graph).toContain("scale=1920:1080");
  });
});

describe("첫 소스에 맞춤", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { zapcut: { probeMedia: async (path: string) => ({ ...hd("x"), path }), needsProxy: async () => false } });
  });

  it("비율을 직접 고른 프로젝트는 첫 소스를 가져와도 그대로다", async () => {
    const { useEditor } = await import("../src/editor/store");
    useEditor.getState().load(newProject(undefined, canvasSize(9, 16, 1080)));
    await useEditor.getState().importFiles(["C:\\v\\one.mp4"]);
    expect(useEditor.getState().project).toMatchObject({ width: 1080, height: 1920 });
  });

  it("첫 소스에 맞춤이면 소스 비율로 바꾸고 해상도 등급은 유지한다", async () => {
    const { useEditor } = await import("../src/editor/store");
    useEditor.getState().load(newProject(undefined, { ...canvasSize(9, 16, 2160), fitFirstMedia: true }));
    await useEditor.getState().importFiles(["C:\\v\\two.mp4"]);
    expect(useEditor.getState().project).toMatchObject({ width: 3840, height: 2160 });
  });

  it("비율을 직접 바꾸면 첫 소스에 맞추지 않는다", async () => {
    const { useEditor } = await import("../src/editor/store");
    useEditor.getState().load(newProject(undefined, { fitFirstMedia: true }));
    useEditor.getState().setProjectProps(canvasSize(1, 1, 1080));
    await useEditor.getState().importFiles(["C:\\v\\three.mp4"]);
    expect(useEditor.getState().project).toMatchObject({ width: 1080, height: 1080 });
    expect(useEditor.getState().project.fitFirstMedia).toBeUndefined();
  });
});
