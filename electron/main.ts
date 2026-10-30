import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { parseCube } from "../src/core/color";
import { buildExportPlan, FILTER_PLACEHOLDER, type ExportAssets, type ExportSettings } from "../src/core/exportPlan";
import type { MediaItem, Project } from "../src/core/types";
import { SOUNDS } from "../src/library/sounds";
import { trackBox, type Box } from "../src/core/track";
import { encoders, extractFrame, makeProxy, needsProxy, probe, reverseRange, run, thumbnails, waveform } from "./ffmpeg";

protocol.registerSchemesAsPrivileged([
  { scheme: "zapcut-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } },
]);

let win: BrowserWindow | null = null;
let exportAbort: AbortController | null = null;
const MEDIA_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|bmp|gif)$/i;
const pendingOpen: string[] = process.argv.slice(1).filter((a) => a.toLowerCase().endsWith(".zapcut"));
// 탐색기의 "연결 프로그램"이나 명령줄로 넘어온 미디어 파일
let pendingMedia: string[] = process.argv.slice(1).filter((a) => MEDIA_EXT.test(a) && existsSync(a));

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};

// WebGL 텍스처로 쓰려면 교차 출처 허용이 필요하다
const CORS = { "Access-Control-Allow-Origin": "*" };

/** zapcut-media://f/<encodeURIComponent(path)> — Range 요청을 지원해야 <video> 탐색이 동작한다 */
async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const file = decodeURIComponent(url.pathname.slice(1));
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response("not found", { status: 404 });
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = request.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const startB = m[1] ? Number(m[1]) : Math.max(0, info.size - Number(m[2]));
    const endB = m[1] && m[2] ? Math.min(Number(m[2]), info.size - 1) : info.size - 1;
    if (startB >= info.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    const body = Readable.toWeb(createReadStream(file, { start: startB, end: endB })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...CORS, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(endB - startB + 1), "Content-Range": `bytes ${startB}-${endB}/${info.size}` },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...CORS, "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(info.size) } });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 940,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: "#141416",
    title: "ZapCut",
    icon: path.join(__dirname, app.isPackaged ? "../dist/icon.png" : "../build/icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") win?.webContents.toggleDevTools();
  });
  // 테스트/검증용: ZAPCUT_SCREENSHOT=경로 → 로드 후 화면을 저장하고 종료
  const shot = process.env.ZAPCUT_SCREENSHOT;
  if (shot) {
    win.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning") console.log(`[renderer ${e.level}] ${e.message}`);
    });
    win.webContents.once("did-finish-load", () => {
      const delay = Number(process.env.ZAPCUT_SCREENSHOT_DELAY ?? 2500);
      // 화면 검증용: 캡처 전에 앱 상태를 조작하는 스크립트 (window.__zapcutStore 사용 가능)
      const js = process.env.ZAPCUT_SCREENSHOT_JS;
      if (js) setTimeout(() => win!.webContents.executeJavaScript(js).catch((e) => console.error("SCREENSHOT_JS", e)), delay * 0.6);
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        await writeFile(shot, img.toPNG());
        app.quit();
      }, delay);
    });
  }
}

const MEDIA_FILTERS = [
  { name: "미디어 파일", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mp3", "wav", "m4a", "aac", "ogg", "flac", "png", "jpg", "jpeg", "webp", "bmp", "gif"] },
  { name: "모든 파일", extensions: ["*"] },
];

ipcMain.handle("media:pick", async () => {
  const r = await dialog.showOpenDialog(win!, { title: "미디어 가져오기", properties: ["openFile", "multiSelections"], filters: MEDIA_FILTERS });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("media:probe", async (_e, file: string) => {
  const item = await probe(file);
  const [thumbs, wave] = await Promise.all([thumbnails(item).catch(() => ({})), waveform(item).catch(() => undefined)]);
  return { ...item, ...thumbs, waveform: wave };
});

ipcMain.handle("media:needsProxy", async (_e, item: Omit<MediaItem, "id">) => needsProxy(item));
ipcMain.handle("media:makeProxy", (_e, file: string) => makeProxy(file));
ipcMain.handle("media:freeze", (_e, file: string, time: number) => extractFrame(file, time));
ipcMain.handle("media:reverse", (_e, file: string, start: number, length: number, hasAudio: boolean) => reverseRange(file, start, length, hasAudio));

const assetDir = async (sub: string) => {
  const dir = path.join(app.getPath("userData"), sub);
  await mkdir(dir, { recursive: true });
  return dir;
};
/** 렌더러에서 만든 PNG(스티커 등)를 저장 */
ipcMain.handle("asset:savePng", async (_e, name: string, dataUrl: string) => {
  const file = path.join(await assetDir("assets"), `${name.replace(/[^\w.-]/g, "_")}.png`);
  if (!existsSync(file)) await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
});
/** 효과음/배경음악 합성 (처음 한 번만) */
ipcMain.handle("sound:generate", async (_e, id: string) => {
  const def = SOUNDS.find((s) => s.id === id);
  if (!def) throw new Error(`알 수 없는 소리: ${id}`);
  const file = path.join(await assetDir("sounds"), `${id}.wav`);
  if (!existsSync(file)) {
    const tmp = `${file}.part.wav`;
    await run("ffmpeg", ["-y", "-v", "error", ...def.args, "-ar", "48000", "-ac", "2", tmp]);
    await rename(tmp, file);
  }
  return file;
});
ipcMain.handle("cube:pick", async () => {
  const r = await dialog.showOpenDialog(win!, { title: "LUT 파일 가져오기", properties: ["openFile"], filters: [{ name: "3D LUT", extensions: ["cube"] }] });
  return r.canceled ? undefined : r.filePaths[0];
});
ipcMain.handle("cube:read", async (_e, file: string) => {
  try {
    return parseCube(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
});

ipcMain.handle("project:save", async (_e, project: Project, filePath?: string) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win!, {
      title: "프로젝트 저장",
      defaultPath: `${project.name}.zapcut`,
      filters: [{ name: "ZapCut 프로젝트", extensions: ["zapcut"] }],
    });
    if (r.canceled || !r.filePath) return undefined;
    target = r.filePath;
  }
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(project, null, 1), "utf8");
  await rename(tmp, target);
  return target;
});

ipcMain.handle("project:open", async (_e, filePath?: string) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showOpenDialog(win!, { title: "프로젝트 열기", properties: ["openFile"], filters: [{ name: "ZapCut 프로젝트", extensions: ["zapcut"] }] });
    if (r.canceled || !r.filePaths[0]) return undefined;
    target = r.filePaths[0];
  }
  const project = JSON.parse(await readFile(target, "utf8")) as Project;
  const missing = project.media.filter((m) => !existsSync(m.path)).map((m) => m.path);
  return { project, filePath: target, missing };
});

ipcMain.handle("project:pending", () => pendingOpen.shift());
ipcMain.handle("media:pending", () => {
  const list = pendingMedia;
  pendingMedia = [];
  return list;
});

const autosavePath = () => path.join(app.getPath("userData"), "autosave.zapcut");
ipcMain.handle("project:autosave", async (_e, project: Project) => {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(autosavePath(), JSON.stringify(project), "utf8");
});
ipcMain.handle("project:recover", async () => {
  if (!existsSync(autosavePath())) return undefined;
  // 쓰는 도중 꺼져 파일이 깨졌으면 복구하지 않는다 (시작 화면이 멈추지 않도록)
  try {
    return JSON.parse(await readFile(autosavePath(), "utf8")) as Project;
  } catch {
    return undefined;
  }
});

ipcMain.handle("export:pickPath", async (_e, name: string, format: string) => {
  const r = await dialog.showSaveDialog(win!, {
    title: "내보내기",
    defaultPath: path.join(app.getPath("videos"), `${name}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  return r.canceled ? undefined : r.filePath;
});

ipcMain.handle("export:encoders", () => encoders());

export interface RenderedText {
  w: number;
  h: number;
  frames: { png: string; from: number; to: number }[]; // png = data URL
}

ipcMain.handle("export:start", async (e, project: Project, settings: ExportSettings, texts: Record<string, RenderedText>, outPath: string) => {
  const work = await mkdtemp(path.join(os.tmpdir(), "zapcut-export-"));
  exportAbort = new AbortController();
  try {
    const assets: ExportAssets = { text: {}, luts: {} };
    for (const [id, t] of Object.entries(texts)) {
      const frames = [];
      for (const [i, fr] of t.frames.entries()) {
        const file = path.join(work, `text_${id}_${i}.png`);
        await writeFile(file, Buffer.from(fr.png.split(",")[1], "base64"));
        frames.push({ file, from: fr.from, to: fr.to });
      }
      assets.text[id] = { w: t.w, h: t.h, frames };
    }
    // 외부 .cube LUT 읽기
    for (const tr of project.tracks)
      for (const c of tr.clips)
        if (c.lut && !assets.luts![c.lut.path]) assets.luts![c.lut.path] = parseCube(await readFile(c.lut.path, "utf8"));
    const plan = buildExportPlan(project, settings, assets, outPath);
    for (const f of plan.files) await writeFile(path.join(work, f.name), f.content, "utf8");
    await writeFile(path.join(work, "graph.txt"), plan.graph, "utf8");
    // LUT 등은 작업 폴더 기준 상대 경로로 참조하므로 cwd를 작업 폴더로 둔다
    const args = plan.args.map((a) => (a === FILTER_PLACEHOLDER ? "graph.txt" : a));
    let buffer = "";
    await run("ffmpeg", args, {
      cwd: work,
      signal: exportAbort.signal,
      onStdout: (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line);
          if (m) e.sender.send("export:progress", Math.min(1, Number(m[1]) / 1e6 / plan.duration));
        }
      },
    });
    return { ok: true as const, path: outPath };
  } catch (err) {
    return { ok: false as const, error: (err as Error).message };
  } finally {
    exportAbort = null;
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
});

ipcMain.handle("export:cancel", () => exportAbort?.abort());

// 얼굴 찾기에 쓰는 파일 (정해진 것만)
// 모델: 설치본 resources/ml, 개발 ml/. WASM 런타임: Vite가 dist/assets에 넣은 것 (개발 중에는 node_modules)
ipcMain.handle("ml:read", async (_e, name: "yunet.onnx" | "ort.wasm") => {
  if (name === "yunet.onnx") return readFile(app.isPackaged ? path.join(process.resourcesPath, "ml", "face_detection_yunet_2023mar.onnx") : path.join(__dirname, "../ml/face_detection_yunet_2023mar.onnx"));
  if (name !== "ort.wasm") throw new Error(`알 수 없는 파일: ${name}`);
  const assets = path.join(__dirname, "../dist/assets");
  const built = existsSync(assets) ? (await readdir(assets)).find((f) => /^ort-wasm-simd-threaded-.*\.wasm$/.test(f)) : undefined;
  return readFile(built ? path.join(assets, built) : path.join(__dirname, "../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm"));
});

/** 얼굴 찾기용 한 프레임: 긴 변을 640에 맞춰 왼쪽 위에 놓은 640×640 BGR (YuNet 입력) */
ipcMain.handle("frame:grab", async (_e, file: string, time: number) => {
  // 사진은 -ss 0을 주면 프레임이 나오지 않으므로 시각이 있을 때만 탐색한다
  const seek = time > 0 ? ["-ss", String(time)] : [];
  const { stdout } = await run("ffmpeg", ["-v", "error", ...seek, "-i", file, "-frames:v", "1", "-vf", "scale=640:640:force_original_aspect_ratio=decrease,pad=640:640:0:0:color=black", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"]);
  if (stdout.length < 640 * 640 * 3) throw new Error("프레임을 읽지 못했습니다");
  return stdout.subarray(0, 640 * 640 * 3);
});

// ── 자동 캡션 (FFmpeg whisper 필터). 모델은 userData/models, 필터 인자에 콜론이 들어가면 안 되므로 cwd를 그 폴더로 ──
const modelsDir = () => path.join(app.getPath("userData"), "models");
let captionAbort: AbortController | null = null;
const dec3 = (v: number) => String(+v.toFixed(3));

ipcMain.handle("caption:models", async () => {
  await mkdir(modelsDir(), { recursive: true });
  return (await readdir(modelsDir())).filter((f) => f.endsWith(".bin"));
});
ipcMain.handle("caption:download", async (e, url: string, file: string, size: number) => {
  await mkdir(modelsDir(), { recursive: true });
  const dest = path.join(modelsDir(), file);
  const tmp = `${dest}.part`;
  captionAbort = new AbortController();
  try {
    const res = await fetch(url, { signal: captionAbort.signal });
    if (!res.ok || !res.body) throw new Error(`모델을 내려받지 못했습니다 (${res.status})`);
    const total = Number(res.headers.get("content-length")) || size;
    const ws = createWriteStream(tmp);
    let got = 0;
    let last = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      got += chunk.length;
      if (!ws.write(chunk)) await new Promise<void>((r) => ws.once("drain", () => r()));
      if (Date.now() - last > 200) {
        last = Date.now();
        e.sender.send("caption:progress", { phase: "download", v: got / total });
      }
    }
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.end(() => resolve());
    });
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw captionAbort?.signal.aborted ? new Error("취소됨") : err;
  } finally {
    captionAbort = null;
  }
});
export interface CaptionRequest {
  path: string;
  start: number; // 원본 시각(초)
  duration: number;
  language: string; // ko, en, … 또는 auto
  model: string; // 파일 이름
}
/** 분석 결과(json 줄들)를 문자열로 돌려준다 */
ipcMain.handle("caption:run", async (e, req: CaptionRequest) => {
  const dir = modelsDir();
  const out = `caption_${Date.now().toString(36)}.json`;
  captionAbort = new AbortController();
  try {
    let buffer = "";
    await run(
      "ffmpeg",
      ["-v", "error", "-nostats", "-progress", "pipe:1", "-ss", dec3(req.start), "-t", dec3(req.duration), "-i", req.path, "-vn", "-af", `whisper=model=${req.model}:language=${req.language}:queue=30:destination=${out}:format=json`, "-f", "null", "-"],
      {
        cwd: dir,
        signal: captionAbort.signal,
        onStdout: (chunk) => {
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const m = /^out_time_us=(\d+)/.exec(line);
            if (m) e.sender.send("caption:progress", { phase: "run", v: Math.min(1, Number(m[1]) / 1e6 / req.duration) });
          }
        },
      },
    );
    return await readFile(path.join(dir, out), "utf8").catch(() => "");
  } finally {
    captionAbort = null;
    await rm(path.join(dir, out), { force: true }).catch(() => undefined);
  }
});
ipcMain.handle("caption:cancel", () => captionAbort?.abort());
ipcMain.handle("caption:saveSrt", async (_e, srt: string, name: string) => {
  const r = await dialog.showSaveDialog(win!, { title: "자막 내보내기", defaultPath: path.join(app.getPath("videos"), `${name}.srt`), filters: [{ name: "SubRip 자막", extensions: ["srt"] }] });
  if (r.canceled || !r.filePath) return undefined;
  await writeFile(r.filePath, srt, "utf8");
  return r.filePath;
});

export interface SilenceRequest {
  path: string;
  start: number; // 원본 시각(초)
  duration: number;
  noiseDb: number; // 이보다 작으면 무음 (예: -35)
  minDur: number; // 이 길이 이상 이어져야 무음 (초)
}
/** 무음 구간(원본 시각 기준, 분석 시작 = 0). silencedetect 결과를 ametadata로 파일에 받아 읽는다 */
ipcMain.handle("silence:detect", async (_e, req: SilenceRequest) => {
  const work = await mkdtemp(path.join(os.tmpdir(), "zapcut-sil-"));
  try {
    await run("ffmpeg", ["-v", "error", "-ss", dec3(req.start), "-t", dec3(req.duration), "-i", req.path, "-vn", "-af", `silencedetect=n=${Math.round(req.noiseDb)}dB:d=${dec3(req.minDur)},ametadata=mode=print:file=sil.txt`, "-f", "null", "-"], { cwd: work });
    const text = await readFile(path.join(work, "sil.txt"), "utf8").catch(() => "");
    const out: { start: number; end: number }[] = [];
    let cur: number | undefined;
    for (const raw of text.split(String.fromCharCode(10))) {
      const line = raw.trim();
      if (line.startsWith("lavfi.silence_start=")) cur = Number(line.slice("lavfi.silence_start=".length));
      else if (line.startsWith("lavfi.silence_end=") && cur !== undefined) {
        out.push({ start: cur, end: Number(line.slice("lavfi.silence_end=".length)) });
        cur = undefined;
      }
    }
    if (cur !== undefined) out.push({ start: cur, end: req.duration }); // 끝까지 무음
    return out.filter((r) => r.end > r.start);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
});

export interface TrackRequest {
  path: string;
  start: number; // 원본 시각(초)
  duration: number; // 원본 길이(초)
  fps: number; // 원본 기준 분석 프레임 수/초
  srcW: number;
  srcH: number;
  box: Box; // 원본 크기 대비 0..1
}
/** 영역 추적: 원본을 작은 흑백 프레임으로 뽑아 상자를 따라간다. 결과 상자도 원본 대비 0..1 */
ipcMain.handle("track:run", async (e, req: TrackRequest) => {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const aw = even(Math.min(480, req.srcW));
  const ah = even((aw * req.srcH) / req.srcW);
  const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(req.start), "-t", String(req.duration), "-i", req.path, "-vf", `fps=${req.fps},scale=${aw}:${ah},format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
  const size = aw * ah;
  const frames: Uint8Array[] = [];
  for (let o = 0; o + size <= stdout.length; o += size) frames.push(new Uint8Array(stdout.buffer, stdout.byteOffset + o, size));
  if (!frames.length) throw new Error("영상에서 프레임을 읽지 못했습니다");
  const r = trackBox(frames, aw, ah, { x: req.box.x * aw, y: req.box.y * ah, w: req.box.w * aw, h: req.box.h * ah }, (done) => e.sender.send("track:progress", done / frames.length));
  return { boxes: r.boxes.map((b) => ({ x: b.x / aw, y: b.y / ah, w: b.w / aw, h: b.h / ah })), lostAt: r.lostAt };
});
ipcMain.handle("shell:showItem", (_e, p: string) => shell.showItemInFolder(p));

export type UpdateStatus = { state: "downloading"; version: string; percent: number } | { state: "ready"; version: string };

/** GitHub 릴리스(package.json build.publish)에서 새 버전을 받아 둔다. 설치는 사용자가 재시작을 누르거나 앱을 끌 때 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  const send = (s: UpdateStatus) => win?.webContents.send("update:status", s);
  let version = "";
  autoUpdater.on("update-available", (info) => {
    version = info.version;
    send({ state: "downloading", version, percent: 0 });
  });
  autoUpdater.on("download-progress", (p) => send({ state: "downloading", version, percent: p.percent }));
  autoUpdater.on("update-downloaded", (info) => send({ state: "ready", version: info.version }));
  // 오프라인이거나 GitHub에 닿지 않으면 조용히 넘어간다
  autoUpdater.on("error", (err) => console.error("update", err.message));
  autoUpdater.checkForUpdates().catch(() => undefined);
}
ipcMain.handle("update:install", () => autoUpdater.quitAndInstall(true, true));
/** 정보 창의 "업데이트 확인". 새 버전이 있으면 시작할 때와 같이 받아 두고 상태를 알린다 */
ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) return { state: "dev" as const };
  try {
    const r = await autoUpdater.checkForUpdates();
    return r?.isUpdateAvailable ? { state: "available" as const, version: r.updateInfo.version } : { state: "latest" as const };
  } catch (err) {
    return { state: "error" as const, message: (err as Error).message };
  }
});

// 정보 창에서 여는 라이선스 문서 (정해진 파일만). [설치본: resources 기준, 개발: 프로젝트 폴더 기준]
const LICENSE_FILES: Record<string, [string, string]> = {
  zapcut: ["licenses/ZapCut-LICENSE.txt", "LICENSE"],
  thirdParty: ["licenses/THIRD-PARTY-NOTICES.txt", "licenses/THIRD-PARTY-NOTICES.txt"],
  ffmpeg: ["ffmpeg/FFMPEG-LICENSE.txt", "build/ffmpeg/FFMPEG-LICENSE.txt"],
  electron: ["../LICENSE.electron.txt", "node_modules/electron/dist/LICENSE"],
  chromium: ["../LICENSES.chromium.html", "node_modules/electron/dist/LICENSES.chromium.html"],
  pretendard: ["licenses/fonts/Pretendard-OFL.txt", "licenses/fonts/Pretendard-OFL.txt"],
  bebas: ["licenses/fonts/BebasNeue-OFL.txt", "licenses/fonts/BebasNeue-OFL.txt"],
  pacifico: ["licenses/fonts/Pacifico-OFL.txt", "licenses/fonts/Pacifico-OFL.txt"],
  yunet: ["licenses/YuNet-LICENSE.txt", "licenses/YuNet-LICENSE.txt"],
};
ipcMain.handle("license:open", (_e, key: string) => {
  const rel = LICENSE_FILES[key];
  if (!rel) return "알 수 없는 라이선스";
  const file = app.isPackaged ? path.join(process.resourcesPath, rel[0]) : path.join(__dirname, "..", rel[1]);
  return shell.openPath(file);
});

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on("second-instance", (_e, argv) => {
    const file = argv.find((a) => a.toLowerCase().endsWith(".zapcut"));
    if (file) win?.webContents.send("project:openExternal", file);
    const media = argv.slice(1).filter((a) => MEDIA_EXT.test(a) && existsSync(a));
    if (media.length) win?.webContents.send("media:importExternal", media);
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.whenReady().then(() => {
    protocol.handle("zapcut-media", serveMedia);
    createWindow();
    // 화면이 상태 알림을 받을 수 있게 된 뒤에 확인한다
    win!.webContents.once("did-finish-load", checkForUpdates);
  });
  app.on("window-all-closed", () => app.quit());
}
