import { describe, expect, it } from "vitest";
import { atempoChain, buildExportPlan, FILTER_PLACEHOLDER, outputSize } from "../src/core/exportPlan";
import { clipFromMedia, moveClip, newProject, normalize, placeClip, projectDuration, resolveOverlap, setSpeed, splitClip, textClip, trimAtPlayhead, trimClip } from "../src/core/timeline";
import type { MediaItem, Project } from "../src/core/types";

const video = (id: string, duration: number): MediaItem => ({ id, kind: "video", path: `C:\\v\\${id}.mp4`, name: `${id}.mp4`, duration, width: 1920, height: 1080, fps: 30, hasAudio: true });

function withMain(...durations: number[]): Project {
  let p = newProject();
  durations.forEach((d, i) => {
    const m = video(`m${i}`, d);
    p = { ...p, media: [...p.media, m] };
    p = placeClip(p, clipFromMedia(m, 1000 + i), p.tracks[0].id);
  });
  return normalize(p, true);
}
const main = (p: Project) => p.tracks.find((t) => t.main)!;

describe("메인 트랙 자석", () => {
  it("클립을 0초부터 빈틈 없이 이어 붙인다", () => {
    const p = withMain(5, 3, 4);
    expect(main(p).clips.map((c) => c.start)).toEqual([0, 5, 8]);
    expect(projectDuration(p)).toBe(12);
  });

  it("드래그로 놓은 위치에 따라 순서를 바꾼다", () => {
    const p = withMain(5, 3, 4);
    const last = main(p).clips[2];
    const moved = normalize(moveClip(p, last.id, main(p).id, 0.5, true), true);
    expect(main(moved).clips.map((c) => c.mediaId)).toEqual(["m2", "m0", "m1"]);
    expect(main(moved).clips.map((c) => c.start)).toEqual([0, 4, 9]);
  });
});

describe("분할과 트림", () => {
  it("분할하면 원본 위치(in)가 이어진다", () => {
    const p = withMain(10);
    const id = main(p).clips[0].id;
    const [res, right] = splitClip(p, id, 4);
    const clips = main(res).clips;
    expect(clips).toHaveLength(2);
    expect(clips[1].id).toBe(right);
    expect(clips[1].in).toBe(4);
    expect(clips[0].duration + clips[1].duration).toBe(10);
  });

  it("배속 클립 분할 시 in은 원본 시간 기준", () => {
    let p = withMain(10);
    const id = main(p).clips[0].id;
    p = setSpeed(p, id, 2);
    expect(main(p).clips[0].duration).toBe(5);
    const [res] = splitClip(p, id, 2);
    expect(main(res).clips[1].in).toBe(4);
  });

  it("Q(왼쪽 삭제) 후 자석이 뒤 클립을 당긴다", () => {
    const p = withMain(10, 5);
    const first = main(p).clips[0].id;
    const res = normalize(trimAtPlayhead(p, first, 3, "left"), true);
    expect(main(res).clips[0].in).toBe(3);
    expect(main(res).clips.map((c) => c.start)).toEqual([0, 7]);
  });

  it("오른쪽 트림은 원본 길이를 넘지 못한다", () => {
    const p = withMain(10);
    const id = main(p).clips[0].id;
    const res = trimClip(p, id, "right", 30);
    expect(main(res).clips[0].duration).toBe(10);
  });
});

describe("다른 트랙으로 끌기 (드래그 중 안정성)", () => {
  // 오버레이 트랙(클립 Y 0~5초) + 메인 트랙(A, B)
  function setup() {
    let p = withMain(4, 4);
    const y = { ...clipFromMedia(video("y", 10), 0), duration: 5 };
    p = normalize(placeClip(p, y), true);
    const overlay = p.tracks.find((t) => !t.main)!;
    return { p, overlayId: overlay.id, a: main(p).clips[0], y };
  }

  it("겹치는 위치로 끌 때 같은 입력이면 항상 같은 결과(트랙 ID 포함)", () => {
    const { p, overlayId, a } = setup();
    const opts = { allowOverlap: true, newTrackId: "trk_drag" };
    const r1 = normalize(moveClip(p, a.id, overlayId, 1, true, opts), true, true);
    const r2 = normalize(moveClip(p, a.id, overlayId, 1, true, opts), true, true);
    expect(r1.tracks.map((t) => t.id)).toEqual(r2.tracks.map((t) => t.id));
    // 드래그 중에는 겨냥한 트랙에 그대로 머문다 (트랙이 새로 생기지 않음)
    expect(r1.tracks.find((t) => t.id === overlayId)!.clips.some((c) => c.id === a.id)).toBe(true);
    expect(r1.tracks.length).toBe(p.tracks.length);
  });

  it("드래그 중에는 빈 트랙을 지우지 않아 줄 위치가 유지된다", () => {
    const { p, overlayId, y } = setup();
    const moved = normalize(moveClip(p, y.id, main(p).id, 1, true, { allowOverlap: true, newTrackId: "trk_drag" }), true, true);
    expect(moved.tracks.map((t) => t.id)).toEqual(p.tracks.map((t) => t.id));
    expect(moved.tracks.find((t) => t.id === overlayId)!.clips).toHaveLength(0);
  });

  it("놓을 때 겹치면 겨냥한 트랙 바로 위에 새 트랙을 만든다", () => {
    const { p, overlayId, a, y } = setup();
    const dragged = normalize(moveClip(p, a.id, overlayId, 1, true, { allowOverlap: true, newTrackId: "trk_drag" }), true, true);
    const done = normalize(resolveOverlap(dragged, a.id), true);
    const idx = done.tracks.findIndex((t) => t.id === overlayId);
    expect(done.tracks[idx - 1].clips.map((c) => c.id)).toEqual([a.id]); // 바로 위 새 트랙
    expect(done.tracks[idx].clips.map((c) => c.id)).toEqual([y.id]); // 원래 클립은 그대로
  });

  it("겹치지 않게 놓으면 그 트랙에 그대로 들어간다", () => {
    const { p, overlayId, a } = setup();
    const done = normalize(resolveOverlap(normalize(moveClip(p, a.id, overlayId, 6, true, { allowOverlap: true }), true, true), a.id), true);
    expect(done.tracks.find((t) => t.id === overlayId)!.clips.map((c) => c.id)).toContain(a.id);
  });
});

describe("트랙 배치", () => {
  it("겹치는 텍스트는 새 트랙을 만든다", () => {
    let p = withMain(10);
    p = placeClip(p, textClip(1));
    p = placeClip(p, textClip(2));
    expect(p.tracks.filter((t) => t.kind === "text")).toHaveLength(2);
    expect(p.tracks[0].kind).toBe("text");
  });
});

describe("내보내기 계획", () => {
  it("atempo는 0.5~2 범위로 나눈다", () => {
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(1)).toEqual([]);
  });

  it("출력 크기는 짝수이고 비율을 유지한다", () => {
    const p = { ...newProject(), width: 1080, height: 1920 };
    expect(outputSize(p, 720)).toEqual({ width: 406, height: 720 });
  });

  it("비디오/텍스트/오디오를 포함한 그래프를 만든다", () => {
    let p = withMain(5, 3);
    const t = textClip(1);
    p = placeClip(p, t);
    const text = { [t.id]: { w: 400, h: 120, frames: [{ file: "C:\\tmp\\t.png", from: 0, to: 3 }] } };
    const plan = buildExportPlan(p, { height: 1080, fps: 30, quality: "high", encoder: "libx264", format: "mp4" }, { text }, "C:\\out.mp4");
    expect(plan.duration).toBe(8);
    expect(plan.args).toContain(FILTER_PLACEHOLDER);
    expect(plan.args).toContain("C:\\tmp\\t.png");
    expect(plan.args.at(-1)).toBe("C:\\out.mp4");
    expect(plan.graph).toContain("[vout]");
    expect(plan.graph).toContain("amix=inputs=2");
  });
});
