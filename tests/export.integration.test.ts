// 실제 ffmpeg로 내보내기 그래프를 렌더링해 검증한다 (ffmpeg가 PATH에 없으면 건너뜀)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EFFECTS, defaultParams } from "../src/core/effects";
import { buildExportPlan, FILTER_PLACEHOLDER, type ExportAssets } from "../src/core/exportPlan";
import { IN_ANIMS, LOOP_ANIMS, OUT_ANIMS } from "../src/core/motion";
import { clipFromMedia, newProject, newTrack, normalize, placeClip, setSpeed, textClip, uid } from "../src/core/timeline";
import { TRANSITIONS } from "../src/core/transitions";
import { DEFAULT_ADJUST, DEFAULT_TRANSFORM, type Clip, type MediaItem, type Project } from "../src/core/types";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
// 1x1 흰 픽셀 PNG (텍스트 레이어 대용)
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

let dir = "";
let mv: MediaItem, mv2: MediaItem, mi: MediaItem, ma: MediaItem, green: MediaItem;
let txt = "";

function render(p: Project, assets: ExportAssets = { text: {} }, height = 180) {
  const out = path.join(dir, `${uid("out")}.mp4`);
  const plan = buildExportPlan(p, { height, fps: 15, quality: "low", encoder: "libx264", format: "mp4" }, assets, out);
  const work = mkdtempSync(path.join(dir, "w-"));
  writeFileSync(path.join(work, "graph.txt"), plan.graph);
  for (const f of plan.files) writeFileSync(path.join(work, f.name), f.content);
  const r = spawnSync("ffmpeg", plan.args.map((a) => (a === FILTER_PLACEHOLDER ? "graph.txt" : a)), { encoding: "utf8", cwd: work });
  if (r.status !== 0) throw new Error(`ffmpeg 실패:\n${r.stderr.slice(-3000)}\n--- graph ---\n${plan.graph}`);
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out], { encoding: "utf8" }));
  return { out, info, duration: Number(info.format.duration), plan };
}

/** 출력의 time 초 프레임 중앙 픽셀 색 */
function pixel(file: string, time: number, x = 0.5, y = 0.5): [number, number, number] {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1", "-vf", `crop=2:2:iw*${x}:ih*${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [buf[0], buf[1], buf[2]];
}

function mainProject(...clips: Clip[]): Project {
  let p = { ...newProject(), width: 640, height: 360, media: [mv, mv2, mi, ma, green] };
  for (const c of clips) p = placeClip(p, c, p.tracks[0].id);
  return normalize(p, true);
}

describe.skipIf(!hasFfmpeg)("ffmpeg 내보내기", () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "zapcut-test-"));
    const v = path.join(dir, "v.mp4");
    const v2 = path.join(dir, "v2.mp4");
    const img = path.join(dir, "img.png");
    const aud = path.join(dir, "a.wav");
    const gr = path.join(dir, "green.mp4");
    txt = path.join(dir, "t.png");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=15:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", v]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=15:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", v2]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=yellow:s=200x200", "-frames:v", "1", img]);
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=660:d=3", aud]);
    // 초록 배경 + 가운데 흰 사각형 (크로마키 시험용)
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x00ff00:s=320x180:r=15:d=3,drawbox=x=110:y=40:w=100:h=100:color=white:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", gr]);
    writeFileSync(txt, Buffer.from(PNG_1PX, "base64"));
    mv = { id: "mv", kind: "video", path: v, name: "v.mp4", duration: 4, width: 320, height: 180, fps: 15, hasAudio: true };
    mv2 = { id: "mv2", kind: "video", path: v2, name: "v2.mp4", duration: 4, width: 320, height: 180, fps: 15, hasAudio: false };
    mi = { id: "mi", kind: "image", path: img, name: "img.png", duration: 0, width: 200, height: 200, fps: 15, hasAudio: false };
    ma = { id: "ma", kind: "audio", path: aud, name: "a.wav", duration: 3, width: 0, height: 0, fps: 0, hasAudio: true };
    green = { id: "green", kind: "video", path: gr, name: "green.mp4", duration: 3, width: 320, height: 180, fps: 15, hasAudio: false };
  }, 60000);

  it("기본 합성: 배속, 회전 오버레이, 텍스트, 오디오", () => {
    let p = mainProject(clipFromMedia(mv, 0), { ...clipFromMedia(mv, 4), in: 1, duration: 3 });
    p = setSpeed(p, p.tracks[0].clips[1].id, 2); // 3초 → 1.5초
    p = placeClip(p, { ...clipFromMedia(mi, 0.5), duration: 2, transform: { x: 0.3, y: -0.2, scale: 0.4, rotation: 30, opacity: 0.7 } });
    const t = textClip(1);
    p = placeClip(p, t);
    p = placeClip(p, { ...clipFromMedia(ma, 2), fadeIn: 0.5, fadeOut: 0.5, volume: 0.8 });
    const r = render(normalize(p, true), { text: { [t.id]: { w: 40, h: 12, frames: [{ file: txt, from: 0, to: 3 }] } } }, 360);
    expect(r.info.streams.find((x: { codec_type: string }) => x.codec_type === "video").height).toBe(360);
    expect(r.info.streams.some((x: { codec_type: string }) => x.codec_type === "audio")).toBe(true);
    expect(r.duration).toBeGreaterThan(5.3);
    expect(r.duration).toBeLessThan(5.8);
  }, 120000);

  it("전환: 모든 종류가 렌더링되고 길이는 유지된다", () => {
    for (const tr of TRANSITIONS) {
      const a = { ...clipFromMedia(mv, 0), duration: 2, transition: { id: tr.id, duration: 0.6 } };
      const b = { ...clipFromMedia(mv2, 2), in: 1, duration: 2 };
      const r = render(mainProject(a, b));
      expect(r.duration, tr.id).toBeGreaterThan(3.85);
      expect(r.duration, tr.id).toBeLessThan(4.2);
    }
  }, 300000);

  it("전환 구간 앞뒤는 각 클립 색", () => {
    const a = { ...clipFromMedia(mv, 0), duration: 2, transition: { id: "fade", duration: 1 } };
    const b = { ...clipFromMedia(mv2, 2), duration: 2 };
    const r = render(mainProject(a, b));
    const before = pixel(r.out, 1.0);
    const mid = pixel(r.out, 2.0);
    const after = pixel(r.out, 3.2);
    expect(before[0]).toBeGreaterThan(200); // 빨강
    expect(after[2]).toBeGreaterThan(200); // 파랑
    expect(mid[0]).toBeGreaterThan(60); // 섞임
    expect(mid[2]).toBeGreaterThan(60);
  }, 60000);

  it("효과: 모든 효과가 렌더링된다", () => {
    for (const def of EFFECTS) {
      let p = mainProject({ ...clipFromMedia(mv, 0), duration: 2 });
      const fx: Clip = { ...clipFromMedia(mi, 0.5), id: uid("fx"), kind: "effect", mediaId: undefined, duration: 1, effect: { id: def.id, params: defaultParams(def) } };
      p = { ...p, tracks: [{ ...newTrack("effect"), clips: [fx] }, ...p.tracks] };
      const r = render(p);
      expect(r.duration, def.id).toBeGreaterThan(1.9);
    }
  }, 300000);

  it("크로마키: 초록 배경이 투명해지고 흰 사각형은 남는다", () => {
    let p = mainProject({ ...clipFromMedia(mv2, 0), duration: 2 }); // 파란 배경
    p = placeClip(p, { ...clipFromMedia(green, 0), duration: 2, chroma: { enabled: true, color: "#00ff00", similarity: 0.25, blend: 0.05 } });
    const r = render(p, { text: {} }, 360);
    const corner = pixel(r.out, 1, 0.05, 0.05);
    const center = pixel(r.out, 1, 0.5, 0.5);
    expect(corner[2]).toBeGreaterThan(180); // 초록 대신 아래 파랑이 보임
    expect(corner[1]).toBeLessThan(80);
    expect(center[0]).toBeGreaterThan(200); // 흰색 유지
  }, 60000);

  it("마스크(원형)·블렌드·필터·자르기·뒤집기·캔버스 블러·조정 레이어", () => {
    const base = { ...clipFromMedia(mv, 0), duration: 2, transform: { ...DEFAULT_TRANSFORM, scale: 0.7 }, canvas: { type: "blur" as const, color: "#000000", blur: 0.5 }, filter: { id: "film-teal-orange", intensity: 0.8 }, crop: { l: 0.1, t: 0, r: 0.1, b: 0 }, flipH: true };
    let p = mainProject(base);
    p = placeClip(p, { ...clipFromMedia(mi, 0), duration: 2, mask: { type: "circle", x: 0, y: 0, w: 0.6, h: 0.6, rotation: 0, feather: 0.1, invert: false } });
    p = placeClip(p, { ...clipFromMedia(mv2, 0), duration: 2, blend: "screen", transform: { ...DEFAULT_TRANSFORM, scale: 0.5 } }, undefined, true);
    const adj: Clip = { ...clipFromMedia(mi, 0), id: uid("adj"), kind: "adjust", mediaId: undefined, duration: 1, adjust: { ...DEFAULT_ADJUST, saturation: -1, vignette: 0.5 } };
    p = { ...p, tracks: [{ ...newTrack("effect"), clips: [adj] }, ...p.tracks] };
    const r = render(p, { text: {} }, 360);
    expect(r.duration).toBeGreaterThan(1.9);
    // 조정 레이어(채도 -1) 구간은 회색조
    const [R, G, B] = pixel(r.out, 0.5, 0.9, 0.5);
    expect(Math.max(R, G, B) - Math.min(R, G, B)).toBeLessThan(16);
  }, 60000);

  it("키프레임·애니메이션(크기/회전/불투명도 수식)·볼륨 키프레임·타자기", () => {
    let p = mainProject({ ...clipFromMedia(mv, 0), duration: 3, keyframes: { volume: [{ t: 0, v: 0, ease: "linear" }, { t: 2, v: 1, ease: "linear" }] } });
    for (let i = 0; i < 3; i++) {
      p = placeClip(
        p,
        {
          ...clipFromMedia(mi, 0),
          duration: 3,
          transform: { ...DEFAULT_TRANSFORM, scale: 0.3 },
          keyframes: { x: [{ t: 0, v: -0.3, ease: "easeInOut" }, { t: 3, v: 0.3, ease: "linear" }], rotation: [{ t: 0, v: 0, ease: "linear" }, { t: 3, v: 90, ease: "linear" }] },
          animIn: { id: IN_ANIMS[i * 4].id, duration: 0.6 },
          animOut: { id: OUT_ANIMS[i * 3 + 1].id, duration: 0.5 },
          animLoop: { id: LOOP_ANIMS[i * 2].id, duration: 1 },
        },
        undefined,
        true,
      );
    }
    const t = { ...textClip(0.5), animIn: { id: "typewriter", duration: 1 } };
    p = placeClip(p, t);
    const frames = [0, 1, 2].map((i) => ({ file: txt, from: i / 3, to: (i + 1) / 3 }));
    frames.push({ file: txt, from: 1, to: 3 });
    const r = render(p, { text: { [t.id]: { w: 40, h: 12, frames } } }, 360);
    expect(r.duration).toBeGreaterThan(2.9);
  }, 120000);
});
