import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { buildExportPlan, FILTER_PLACEHOLDER, type ExportSettings } from "../src/core/exportPlan";
import type { Project } from "../src/core/types";
import { encoders, probe, run, thumbnails, waveform } from "./ffmpeg";

protocol.registerSchemesAsPrivileged([
  { scheme: "zapcut-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true } },
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
      headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(endB - startB + 1), "Content-Range": `bytes ${startB}-${endB}/${info.size}` },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers: { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": String(info.size) } });
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
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        await writeFile(shot, img.toPNG());
        app.quit();
      }, Number(process.env.ZAPCUT_SCREENSHOT_DELAY ?? 2500));
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
  return JSON.parse(await readFile(autosavePath(), "utf8")) as Project;
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

ipcMain.handle("export:start", async (e, project: Project, settings: ExportSettings, textPngs: Record<string, string>, outPath: string) => {
  const work = await mkdtemp(path.join(os.tmpdir(), "zapcut-export-"));
  exportAbort = new AbortController();
  try {
    const textImages: Record<string, string> = {};
    for (const [id, dataUrl] of Object.entries(textPngs)) {
      const file = path.join(work, `${id}.png`);
      await writeFile(file, Buffer.from(dataUrl.split(",")[1], "base64"));
      textImages[id] = file;
    }
    const plan = buildExportPlan(project, settings, textImages, outPath);
    const script = path.join(work, "graph.txt");
    await writeFile(script, plan.graph, "utf8");
    const args = plan.args.map((a) => (a === FILTER_PLACEHOLDER ? script : a));
    let buffer = "";
    await run("ffmpeg", args, {
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
  });
  app.on("window-all-closed", () => app.quit());
}
