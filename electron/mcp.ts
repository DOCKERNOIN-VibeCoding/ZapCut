// ZapCut MCP 브리지: Claude 같은 MCP 클라이언트가 stdio로 띄우는 서버. Electron을 쓰지 않는 순수 Node 스크립트로,
// 실행 중인 ZapCut의 제어 채널(userData/control.json에 적힌 127.0.0.1 포트·토큰)에 명령을 전달한다.
// 등록: claude mcp add zapcut -e ELECTRON_RUN_AS_NODE=1 -- "<ZapCut.exe>" "<이 파일>"  (ZapCut 정보 창에서 복사할 수 있다)
// stdout은 MCP 프로토콜 전용이다. 로그는 console.error로만 쓴다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { TOOLS } from "./mcpTools";

declare const __APP_VERSION__: string; // scripts/build-mcp.mjs가 package.json 버전으로 채운다

interface Control {
  port: number;
  token: string;
}

const controlFile = () => process.env.ZAPCUT_CONTROL_FILE ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ZapCut", "control.json");

async function readControl(): Promise<Control | undefined> {
  try {
    return JSON.parse(await readFile(controlFile(), "utf8")) as Control;
  } catch {
    return undefined;
  }
}

function request(c: Control, method: string, p: string, body?: unknown): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: c.port,
        method,
        path: p,
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json", ...(data ? { "Content-Length": data.length } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("error", reject);
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function alive(c: Control) {
  try {
    return (await request(c, "GET", "/health")).ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 제어 채널에 연결한다. 앱이 꺼져 있으면 띄우고 기다린다 (단일 인스턴스라 이미 켜져 있으면 창만 앞으로 온다) */
async function connect(): Promise<Control> {
  const c = await readControl();
  if (c && (await alive(c))) return c;
  const exe = process.env.ZAPCUT_APP ?? (/zapcut\.exe$/i.test(process.execPath) ? process.execPath : undefined);
  if (exe) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // 이 값이 남아 있으면 앱이 Node로 실행된다
    spawn(exe, [], { detached: true, stdio: "ignore", env }).unref();
  }
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const c2 = await readControl();
    if (c2 && (await alive(c2))) return c2;
  }
  throw new Error(
    (exe ? "ZapCut에 연결할 수 없습니다." : "ZapCut이 실행 중이지 않거나 외부 제어가 꺼져 있습니다. ZapCut을 켜고,") +
      " ZapCut 정보 창(상단 로고 클릭)에서 '외부 제어(MCP) 허용'을 켜 주세요.",
  );
}

async function call(name: string, args: unknown): Promise<unknown> {
  const c = await connect();
  const r = await request(c, "POST", "/call", { name, args });
  if (!r.ok) throw new Error(r.error ?? "알 수 없는 오류");
  return r.result;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v ?? null, null, 1) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (e as Error).message ?? String(e) }] });

const INSTRUCTIONS = `ZapCut(짭컷) 동영상 편집기를 조종하는 도구입니다. 편집기 창이 함께 열려 있어 사용자가 변경을 바로 보고 Ctrl+Z로 되돌릴 수 있습니다.

기본 흐름: get_state로 상태 확인 → (new_project) → import_media(로컬 경로 또는 http URL) → add_to_timeline(append=true로 이어 붙이기) → add_text / add_title → update_clip으로 다듬기 → screenshot(time)으로 눈으로 확인 → export(path) → save_project(path).

단위: 시간은 초. 위치 x, y는 캔버스 중심 기준 비율(0 = 가운데, ±0.5 = 화면 끝). scale 1 = 캔버스에 맞춤. fontSize는 1080p 기준 px. 색은 #rrggbb.
트랙: 메인 트랙(main=true)의 클립은 빈틈 없이 이어지며 자석이 켜져 있으면 자동으로 당겨 붙습니다. 텍스트·타이틀·스티커는 메인 트랙 위의 별도 트랙에 놓입니다. 전환(transition)은 메인 트랙에서 다음 클립으로 넘어갈 때 적용됩니다.
export는 기본으로 끝날 때까지 기다립니다(수 분 걸릴 수 있음). 클라이언트에 시간 제한이 있으면 wait=false로 시작하고 export_status로 확인하세요.
ID 목록(타이틀 템플릿·전환·필터·효과·애니메이션 등)은 list_library로 봅니다.`;

async function main() {
  const server = new McpServer({ name: "zapcut", version: __APP_VERSION__ }, { instructions: INSTRUCTIONS });
  for (const [name, t] of Object.entries(TOOLS)) {
    server.registerTool(name, { title: t.title, description: t.description, inputSchema: t.schema, annotations: { readOnlyHint: !!t.readOnly } }, async (args) => {
      try {
        if (name === "screenshot") {
          const r = (await call(name, args)) as { png: string; width: number; height: number };
          return { content: [{ type: "image" as const, data: r.png, mimeType: "image/png" }, { type: "text" as const, text: `${r.width}×${r.height}` }] };
        }
        if (name === "import_media") {
          // URL은 먼저 내려받아 로컬 경로로 바꾼다
          const paths = await Promise.all(
            ((args as { paths: string[] }).paths ?? []).map(async (p) => (/^https?:\/\//i.test(p) ? ((await call("download", { url: p })) as { path: string }).path : p)),
          );
          return text(await call(name, { ...(args as object), paths }));
        }
        return text(await call(name, args));
      } catch (e) {
        return fail(e);
      }
    });
  }
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
