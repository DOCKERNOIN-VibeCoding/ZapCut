import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { parseCube } from "../src/core/color";
import { buildExportPlan, FILTER_PLACEHOLDER, type ExportAssets, type ExportSettings } from "../src/core/exportPlan";
import type { MediaItem, Project } from "../src/core/types";
import { SOUNDS } from "../src/library/sounds";
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
