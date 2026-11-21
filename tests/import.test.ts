import { afterEach, describe, expect, it, vi } from "vitest";
import { newProject } from "../src/core/timeline";
import type { MediaItem } from "../src/core/types";
import { useEditor } from "../src/editor/store";

const info: Omit<MediaItem, "id"> = { kind: "video", path: "C:\\v\\big.mp4", name: "big.mp4", duration: 600, width: 3840, height: 2160, fps: 30, hasAudio: true };

describe("큰 파일 가져오기", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("필름스트립·파형을 기다리지 않고 끝나고, 준비되면 뒤에서 채운다 (실행 취소해도 남음)", async () => {
    let finish!: (x: { waveform: number[]; filmstrip: string; filmstripFrames: number }) => void;
    vi.stubGlobal("window", {
      zapcut: {
        probeMedia: async () => info,
        needsProxy: async () => false,
        mediaExtras: () => new Promise((r) => (finish = r)),
      },
    });
    useEditor.getState().load(newProject());
    const [m] = await useEditor.getState().importFiles([info.path]);
    expect(m.waveform).toBeUndefined();
    useEditor.getState().addMediaToTimeline(m.id, 0);

    finish({ waveform: [0.5, 0.2], filmstrip: "strip.jpg", filmstripFrames: 30 });
    await vi.waitFor(() => expect(useEditor.getState().project.media[0].waveform).toEqual([0.5, 0.2]));
    expect(useEditor.getState().project.media[0].filmstrip).toBe("strip.jpg");
    useEditor.getState().undo(); // 타임라인에 넣기 취소
    expect(useEditor.getState().project.media[0].waveform).toEqual([0.5, 0.2]);
  });
});
