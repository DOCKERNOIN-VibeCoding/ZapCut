// 실제 ffmpeg로 내보내기 그래프를 렌더링해 검증한다 (ffmpeg가 PATH에 없으면 건너뜀)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportPlan, FILTER_PLACEHOLDER } from "../src/core/exportPlan";
import { clipFromMedia, newProject, normalize, placeClip, setSpeed, textClip } from "../src/core/timeline";
import { DEFAULT_ADJUST, type MediaItem } from "../src/core/types";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// 1x1 흰 픽셀 PNG (텍스트 레이어 대용)
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe.skipIf(!hasFfmpeg)("ffmpeg 내보내기", () => {
  it("비디오+이미지+텍스트+오디오를 렌더링한다", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "zapcut-test-"));
    const v = path.join(dir, "v.mp4");
    const img = path.join(dir, "img.png");
    const aud = path.join(dir, "a.wav");
    const txt = path.join(dir, "t.png");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", v]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=200x200", "-frames:v", "1", img]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=660:d=3", aud]);
    writeFileSync(txt, Buffer.from(PNG_1PX, "base64"));

    const mv: MediaItem = { id: "mv", kind: "video", path: v, name: "v.mp4", duration: 4, width: 640, height: 360, fps: 30, hasAudio: true };
    const mi: MediaItem = { id: "mi", kind: "image", path: img, name: "img.png", duration: 0, width: 200, height: 200, fps: 30, hasAudio: false };
    const ma: MediaItem = { id: "ma", kind: "audio", path: aud, name: "a.wav", duration: 3, width: 0, height: 0, fps: 0, hasAudio: true };
    let p = { ...newProject(), width: 1280, height: 720, media: [mv, mi, ma] };
    const c1 = clipFromMedia(mv, 0);
    const c2 = { ...clipFromMedia(mv, 4), in: 1, duration: 3 };
    p = placeClip(p, c1, p.tracks[0].id);
    p = placeClip(p, c2, p.tracks[0].id);
    p = setSpeed(normalize(p, true), c2.id, 2); // 3초 원본 → 1.5초
    const overlay = { ...clipFromMedia(mi, 0.5), duration: 2, transform: { x: 0.3, y: -0.2, scale: 0.4, rotation: 30, opacity: 0.7 }, adjust: { ...DEFAULT_ADJUST, brightness: 0.1, contrast: 0.2, saturation: -0.5 } };
    p = placeClip(p, overlay);
    const t = textClip(1);
    p = placeClip(p, t);
    p = placeClip(p, { ...clipFromMedia(ma, 2), fadeIn: 0.5, fadeOut: 0.5, volume: 0.8 });
    p = normalize(p, true);

    const out = path.join(dir, "out.mp4");
    const plan = buildExportPlan(p, { height: 360, fps: 30, quality: "low", encoder: "libx264", format: "mp4" }, { [t.id]: txt }, out);
    const script = path.join(dir, "graph.txt");
    writeFileSync(script, plan.graph);
    const r = spawnSync("ffmpeg", plan.args.map((a) => (a === FILTER_PLACEHOLDER ? script : a)), { encoding: "utf8" });
    expect(r.stderr.slice(-2000)).not.toMatch(/Error|Invalid/);
    expect(r.status).toBe(0);

    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out], { encoding: "utf8" }));
    const vs = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect(vs.width).toBe(640);
    expect(vs.height).toBe(360);
    expect(info.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(true);
    // 4초 + 1.5초 = 5.5초
    expect(Number(info.format.duration)).toBeGreaterThan(5.3);
    expect(Number(info.format.duration)).toBeLessThan(5.8);
  }, 120000);
});
