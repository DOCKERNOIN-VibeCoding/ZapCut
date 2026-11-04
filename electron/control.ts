// 외부 제어 채널: Claude 같은 외부 프로그램(MCP 브리지)이 이 PC 안에서 앱을 조종하는 통로.
// 127.0.0.1의 임의 포트에 HTTP 서버를 열고 포트·토큰을 userData/control.json에 적어 두면 브리지(electron/mcp.ts)가 읽어 연결한다.
// 명령은 이름이 정해진 것만 받는다: 렌더러의 처리기(src/editor/control.ts) 또는 아래 메인 처리기. 설정에서 켜야 동작하며 기본은 꺼짐.
import { app, BrowserWindow, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface Settings {
  control: boolean; // 외부 제어(MCP) 허용
}
export interface ControlInfo {
  enabled: boolean;
  port?: number;
  exe: string;
  script: string; // MCP 브리지 스크립트
  command: string; // Claude Code 등록 명령
  json: string; // Claude Desktop 등 설정 파일용
}

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const controlPath = () => path.join(app.getPath("userData"), "control.json");

let settings: Settings | undefined;
export async function loadSettings(): Promise<Settings> {
  if (settings) return settings;
  try {
    settings = { control: false, ...(JSON.parse(await readFile(settingsPath(), "utf8")) as Partial<Settings>) };
  } catch {
    settings = { control: false };
  }
  return settings;
}
async function saveSettings(patch: Partial<Settings>) {
  settings = { ...(await loadSettings()), ...patch };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(settings, null, 1), "utf8");
  return settings;
}

/** MCP 브리지 스크립트 위치 (설치본: resources/mcp, 개발: dist-electron) */
export const mcpScriptPath = () => (app.isPackaged ? path.join(process.resourcesPath, "mcp", "zapcut-mcp.cjs") : path.join(__dirname, "mcp.cjs"));

/** `ZapCut.exe --mcp`: 창 없이 브리지를 Node 모드로 실행하고 stdio를 그대로 넘긴다 */
export function runMcpBridge() {
  const child = spawn(process.execPath, [mcpScriptPath(), ...process.argv.slice(1).filter((a) => a !== "--mcp")], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.on("exit", (code) => app.exit(code ?? 0));
  child.on("error", (e) => {
    console.error(e);
    app.exit(1);
  });
}

// ── 렌더러 호출: 메인 → control:call → 프리로드가 처리기를 부르고 control:reply로 답한다 ──
let getWin: () => BrowserWindow | null = () => null;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
ipcMain.on("control:reply", (_e, id: string, r: { ok: true; result: unknown } | { ok: false; error: string }) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (r.ok) p.resolve(r.result);
  else p.reject(new Error(r.error));
});
function callRenderer(name: string, args: unknown): Promise<unknown> {
  const win = getWin();
  if (!win || win.isDestroyed()) return Promise.reject(new Error("ZapCut 창이 없습니다"));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    win.webContents.send("control:call", id, name, args);
  });
}
const failPending = (why: string) => {
  for (const p of pending.values()) p.reject(new Error(why));
  pending.clear();
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const extFromType = (t: string | null) =>
  !t ? "" : t.includes("mp4") ? ".mp4" : t.includes("quicktime") ? ".mov" : t.includes("webm") ? ".webm" : t.includes("png") ? ".png" : t.includes("jpeg") ? ".jpg" : t.includes("wav") ? ".wav" : t === "audio/mpeg" ? ".mp3" : "";

/** 메인 프로세스에서 처리하는 명령 (나머지는 렌더러로 넘긴다) */
const mainHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  /** 미리보기 영역(또는 창 전체)을 PNG로. time을 주면 그 시점으로 옮긴 뒤 찍는다 */
  async screenshot(args) {
    const win = getWin();
    if (!win) throw new Error("ZapCut 창이 없습니다");
    const seek = typeof args.time === "number";
    if (seek) await callRenderer("set_playhead", { time: args.time });
    if (win.isMinimized()) win.restore();
    const rect = args.region === "window" ? undefined : ((await callRenderer("preview_rect", {})) as { x: number; y: number; width: number; height: number } | undefined);
    await sleep(seek ? 700 : 150); // 영상 탐색과 다시 그리기를 기다린다
    const img = await win.webContents.capturePage(
      rect && rect.width > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
    );
    const size = img.getSize();
    return { png: img.toPNG().toString("base64"), width: size.width, height: size.height };
  },
  /** http(s) URL을 userData/downloads에 내려받아 경로를 돌려준다 (생성형 AI 서비스가 만든 영상 가져오기) */
  async download(args) {
    const url = String(args.url ?? "");
    if (!/^https?:\/\//i.test(url)) throw new Error("http(s) URL만 내려받을 수 있습니다");
    const dir = path.join(app.getPath("userData"), "downloads");
    await mkdir(dir, { recursive: true });
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`내려받기 실패: HTTP ${res.status}`);
    const fromUrl = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    let name = String(args.name || fromUrl || "download").replace(/[^\w.\-가-힣 ]/g, "_");
    if (!path.extname(name)) name += extFromType(res.headers.get("content-type"));
    const { name: stem, ext } = path.parse(name);
    let file = path.join(dir, name);
    for (let i = 2; existsSync(file); i++) file = path.join(dir, `${stem}-${i}${ext}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
    return { path: file };
  },
  async app_info() {
    return { version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath("userData"), script: mcpScriptPath() };
  },
};

// ── HTTP 서버 ──
let server: http.Server | null = null;
let token = "";
let port = 0;

function authorized(req: http.IncomingMessage) {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(token);
  return want.length > 0 && given.length === want.length && timingSafeEqual(given, want);
}
async function readBody(req: http.IncomingMessage, limit = 20 * 1024 * 1024) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new Error("요청이 너무 큽니다");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  // 브라우저에서 다른 호스트 이름으로 접근하는 것(DNS 리바인딩)을 막는다
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) return json(res, 403, { ok: false, error: "forbidden" });
  if (!authorized(req)) return json(res, 401, { ok: false, error: "unauthorized" });
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, version: app.getVersion(), ready: !!getWin() });
  if (req.method === "POST" && req.url === "/call") {
    const { name, args } = JSON.parse(await readBody(req)) as { name: string; args?: Record<string, unknown> };
    try {
      const result = name in mainHandlers ? await mainHandlers[name](args ?? {}) : await callRenderer(name, args ?? {});
      return json(res, 200, { ok: true, result: result ?? null });
    } catch (e) {
      return json(res, 200, { ok: false, error: (e as Error).message ?? String(e) });
    }
  }
  json(res, 404, { ok: false, error: "not found" });
}

export async function startControl() {
  if (server) return;
  token = randomBytes(24).toString("hex");
  const s = http.createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { ok: false, error: (e as Error).message }));
  });
  s.requestTimeout = 0; // 내보내기처럼 오래 걸리는 호출을 끊지 않는다
  s.headersTimeout = 60_000;
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => resolve());
  });
  server = s;
  port = (s.address() as AddressInfo).port;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(controlPath(), JSON.stringify({ port, token, pid: process.pid, version: app.getVersion() }), "utf8");
}

export async function stopControl() {
  const s = server;
  server = null;
  port = 0;
  if (s) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  await rm(controlPath(), { force: true }).catch(() => undefined);
}

// Claude Code 등록 인자 (-s user: 어느 폴더에서 연 Claude Code에서든 쓸 수 있게)
const MCP_ADD = ["mcp", "add", "zapcut", "-s", "user", "-e", "ELECTRON_RUN_AS_NODE=1", "--"];

export function controlInfo(): ControlInfo {
  const exe = process.execPath;
  const script = mcpScriptPath();
  return {
    enabled: !!server,
    port: server ? port : undefined,
    exe,
    script,
    command: `claude ${MCP_ADD.join(" ")} "${exe}" "${script}"`,
    json: JSON.stringify({ mcpServers: { zapcut: desktopEntry(exe, script) } }, null, 2),
  };
}

// Claude 앱(채팅) 설정 파일의 mcpServers.zapcut 항목
const desktopEntry = (exe: string, script: string) => ({ command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: "1" } });

/** Claude Code 실행 파일. PATH가 없거나 잘못돼 있어도 찾도록 기본 설치 위치도 본다 */
function findClaude(): string | undefined {
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), ".local", "bin"), // 기본 설치
    path.join(process.env.APPDATA ?? "", "npm"), // npm 설치
  ];
  for (const d of dirs) for (const f of ["claude.exe", "claude.cmd"]) if (existsSync(path.join(d, f))) return path.join(d, f);
}

function runClaude(claude: string, args: string[]) {
  // .cmd(npm 설치)는 cmd.exe를 거쳐야 실행된다
  const cmd = claude.toLowerCase().endsWith(".cmd");
  const file = cmd ? "cmd.exe" : claude;
  const argv = cmd ? ["/d", "/s", "/c", `"${[claude, ...args].map((a) => `"${a}"`).join(" ")}"`] : args;
  return new Promise<void>((resolve, reject) =>
    execFile(file, argv, { timeout: 60_000, windowsHide: true, windowsVerbatimArguments: cmd }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || stdout || err.message).trim())) : resolve(),
    ),
  );
}

/** Claude 앱(채팅) 설정 파일이 있는 폴더들. 설치 방식에 따라 위치가 다르다 */
async function desktopConfigDirs() {
  const local = process.env.LOCALAPPDATA ?? "";
  const sub = async (dir: string, prefix: string) => (await readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(prefix)).map((n) => path.join(dir, n));
  const candidates = [
    ...(await sub(path.join(local, "Claude-Data"), "claude_")), // 스토어(MSIX) 설치, 최신
    ...(await sub(path.join(local, "Packages"), "Claude_")).map((p) => path.join(p, "LocalCache", "Roaming", "Claude")), // 스토어 설치, 이전
    path.join(process.env.APPDATA ?? "", "Claude"), // 홈페이지에서 받은 설치
  ];
  const dirs: string[] = [];
  for (const d of candidates) {
    const names = await readdir(d).catch(() => undefined);
    // 데이터를 Claude-Data로 옮긴 옛 폴더에는 표시 파일(.user-data-left.*)만 남는다
    if (names && !names.some((n) => n.startsWith(".user-data-left"))) dirs.push(d);
  }
  return dirs;
}

/** 설정 파일의 다른 내용(다른 MCP 서버·환경 설정)은 그대로 두고 zapcut 항목만 넣는다 */
async function registerDesktop(dir: string) {
  const file = path.join(dir, "claude_desktop_config.json");
  const text = (await readFile(file, "utf8").catch(() => "")).replace(/^﻿/, "");
  const cfg = text.trim() ? JSON.parse(text) : {}; // 깨진 파일이면 여기서 실패하고 덮어쓰지 않는다
  cfg.mcpServers = { ...cfg.mcpServers, zapcut: desktopEntry(process.execPath, mcpScriptPath()) };
  await writeFile(file + ".tmp", JSON.stringify(cfg, null, 2), "utf8");
  await rename(file + ".tmp", file);
}

/** 정보 창 'Claude에 바로 등록': Claude Code(사용자 범위)와 Claude 앱(채팅)에 함께 등록한다 */
async function registerClaude(): Promise<{ ok: boolean; message: string }> {
  const lines: string[] = [];
  let ok = true;
  let done = false;
  const claude = findClaude();
  if (claude) {
    // 이미 등록돼 있으면(예전 설치 경로 등) 지우고 다시 등록한다
    await runClaude(claude, ["mcp", "remove", "zapcut", "-s", "user"]).catch(() => undefined);
    try {
      await runClaude(claude, [...MCP_ADD, process.execPath, mcpScriptPath()]);
      lines.push("Code 등록 완료");
      done = true;
    } catch (e) {
      lines.push(`Code 등록 실패: ${(e as Error).message}`);
      ok = false;
    }
  }
  const dirs = await desktopConfigDirs();
  if (dirs.length) {
    try {
      for (const d of dirs) await registerDesktop(d);
      lines.push("채팅 등록 완료");
      done = true;
    } catch (e) {
      lines.push(`채팅 등록 실패: ${(e as Error).message}`);
      ok = false;
    }
  }
  if (!claude && !dirs.length) return { ok: false, message: "Claude Code와 Claude 앱을 찾지 못했습니다. 위 명령을 Claude Code에 붙여 넣거나 JSON으로 등록하세요." };
  if (!claude) lines.push("Code: 설치되어 있지 않음");
  if (!dirs.length) lines.push("채팅: Claude 앱이 설치되어 있지 않음");
  if (done) lines.push("Claude를 완전히 종료 후 재시작해야 합니다.");
  return { ok, message: lines.join("\n") };
}

/** 창을 만든 뒤 호출. 설정이 켜져 있으면 서버를 띄운다 */
export async function setupControl(win: BrowserWindow) {
  getWin = () => win;
  win.webContents.on("did-finish-load", () => failPending("화면이 다시 로드되었습니다"));
  win.webContents.on("render-process-gone", () => failPending("화면 프로세스가 종료되었습니다"));
  win.on("closed", () => failPending("창이 닫혔습니다"));
  if ((await loadSettings()).control) await startControl().catch((e) => console.error("control", e));
}

ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:set", async (_e, patch: Partial<Settings>) => {
  const s = await saveSettings(patch);
  if (s.control) await startControl();
  else await stopControl();
  return s;
});
ipcMain.handle("control:info", () => controlInfo());
ipcMain.handle("control:register", () => registerClaude());
// 꺼질 때 다른 프로세스가 죽은 포트로 연결하지 않도록 파일을 지운다
app.on("will-quit", () => {
  if (server) rmSync(controlPath(), { force: true });
});
