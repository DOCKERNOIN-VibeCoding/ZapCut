import { app } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaItem, MediaKind } from "../src/core/types";
import { WAVE_RATE } from "../src/core/types";

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** 번들된 ffmpeg → 환경변수 → PATH 순서로 찾는다. */
export function toolPath(name: "ffmpeg" | "ffprobe") {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, "ffmpeg", exe(name)) : "",
    process.env.ZAPCUT_FFMPEG_DIR ? path.join(process.env.ZAPCUT_FFMPEG_DIR, exe(name)) : "",
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? exe(name);
}

export function run(tool: "ffmpeg" | "ffprobe", args: string[], opts: { onStdout?: (s: string) => void; signal?: AbortSignal; cwd?: string } = {}) {
  return new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(toolPath(tool), args, { windowsHide: true, cwd: opts.cwd });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      if (opts.onStdout) opts.onStdout(d.toString());
      else out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-20000);
    });
    const abort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", abort);
    child.on("error", (e) => reject(new Error(`${tool} 실행 실패: ${e.message}`)));
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", abort);
      if (opts.signal?.aborted) reject(new Error("취소됨"));
      else if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new Error(`${tool} 오류 (코드 ${code}): ${err.split("\n").slice(-6).join("\n")}`));
    });
  });
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const cacheRoot = () => path.join(app.getPath("userData"), "cache");

async function cacheKey(file: string) {
  const s = await stat(file);
  return createHash("sha1").update(`${file}|${s.size}|${s.mtimeMs}`).digest("hex").slice(0, 16);
}

function parseRate(r?: string) {
  if (!r) return 0;
  const [a, b] = r.split("/").map(Number);
  return b ? a / b : a || 0;
}

export async function probe(file: string): Promise<Omit<MediaItem, "id">> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  const info = JSON.parse(stdout.toString());
  const streams: any[] = info.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === "audio");
  const ext = path.extname(file).toLowerCase();
  const kind: MediaKind = IMAGE_EXT.has(ext) ? "image" : v ? "video" : a ? "audio" : "video";
  if (!v && !a) throw new Error("지원하지 않는 파일입니다");
  const rotation = Number(v?.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  const swap = Math.abs(rotation) % 180 === 90;
  return {
    kind,
    path: file,
    name: path.basename(file),
    duration: kind === "image" ? 0 : Number(info.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    width: (swap ? v?.height : v?.width) ?? 0,
    height: (swap ? v?.width : v?.height) ?? 0,
    fps: parseRate(v?.avg_frame_rate) || 30,
    hasAudio: !!a,
    codec: v?.codec_name ?? a?.codec_name,
  };
}

export async function thumbnails(item: Omit<MediaItem, "id">) {
  if (item.kind === "audio") return {};
  const dir = path.join(cacheRoot(), await cacheKey(item.path));
  await mkdir(dir, { recursive: true });
  const thumb = path.join(dir, "thumb.jpg");
  if (!existsSync(thumb)) {
    const at = item.kind === "video" ? Math.min(1, item.duration / 2) : 0;
    await run("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", item.path, "-frames:v", "1", "-vf", "scale=240:-2", thumb]);
  }
  if (item.kind !== "video") return { thumbnail: thumb };
  const frames = Math.max(1, Math.min(30, Math.ceil(item.duration / 2)));
  const strip = path.join(dir, `strip${frames}.jpg`);
  if (!existsSync(strip)) {
    const interval = item.duration / frames;
    await run("ffmpeg", ["-y", "-v", "error", "-i", item.path, "-vf", `fps=1/${interval.toFixed(4)},scale=-2:72,tile=${frames}x1`, "-frames:v", "1", strip]);
  }
  return { thumbnail: thumb, filmstrip: strip, filmstripFrames: frames };
}

export async function waveform(item: Omit<MediaItem, "id">): Promise<number[] | undefined> {
  if (!item.hasAudio || item.kind === "image") return undefined;
  const dir = path.join(cacheRoot(), await cacheKey(item.path));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "wave.json");
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const rate = 4000;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", item.path, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2));
  const per = rate / WAVE_RATE;
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let m = 0;
    for (let j = i; j < Math.min(samples.length, i + per); j++) m = Math.max(m, Math.abs(samples[j]));
    peaks.push(+(m / 32768).toFixed(3));
  }
  await writeFile(file, JSON.stringify(peaks));
  return peaks;
}

const PLAYABLE_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const PLAYABLE_EXT = new Set([".mp4", ".m4v", ".mov", ".webm"]);

/** 브라우저(미리보기)에서 재생하기 어려운 동영상인지 */
export function needsProxy(item: Omit<MediaItem, "id">) {
  if (item.kind !== "video") return false;
  return !PLAYABLE_CODECS.has(item.codec ?? "") || !PLAYABLE_EXT.has(path.extname(item.path).toLowerCase());
}

async function derived(file: string, suffix: string) {
  const dir = path.join(cacheRoot(), await cacheKey(file));
  await mkdir(dir, { recursive: true });
  return path.join(dir, suffix);
}

/** 미리보기용 H.264 프록시 (원본은 내보내기에 그대로 사용) */
export async function makeProxy(file: string) {
  const out = await derived(file, "proxy.mp4");
  if (existsSync(out)) return out;
  const tmp = `${out}.part.mp4`;
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-g", "15", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]);
  const { rename } = await import("node:fs/promises");
  await rename(tmp, out);
  return out;
}

/** 정지 프레임 PNG */
export async function extractFrame(file: string, time: number) {
  const out = await derived(file, `frame_${time.toFixed(3)}.png`);
  if (!existsSync(out)) await run("ffmpeg", ["-y", "-v", "error", "-ss", String(time), "-i", file, "-frames:v", "1", out]);
  return out;
}

/** 구간을 거꾸로 재생하는 파일 (영상+소리) */
export async function reverseRange(file: string, start: number, length: number, hasAudio: boolean) {
  const out = await derived(file, `reverse_${start.toFixed(3)}_${length.toFixed(3)}.mp4`);
  if (existsSync(out)) return out;
  const args = ["-y", "-v", "error", "-ss", String(start), "-t", String(length), "-i", file, "-vf", "reverse", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"];
  if (hasAudio) args.push("-af", "areverse", "-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  await run("ffmpeg", [...args, out]);
  return out;
}

export async function encoders(): Promise<string[]> {
  try {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-encoders"]);
    return ["h264_nvenc", "h264_qsv", "h264_amf", "hevc_nvenc", "libx264", "libx265"].filter((e) => stdout.toString().includes(` ${e} `));
  } catch {
    return [];
  }
}
