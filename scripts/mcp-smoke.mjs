// MCP 연동 점검: 실행 중인 ZapCut(정보 창에서 외부 제어 켬)에 실제 MCP 클라이언트로 붙어
// 새 프로젝트 → 가져오기 → 타임라인 → 텍스트·타이틀 → 분할·되돌리기 → 화면 캡처 → 내보내기 → 저장까지 돌려 본다.
// 사용: node scripts/mcp-smoke.mjs   (ffmpeg·ffprobe가 PATH에 있어야 하고, 결과는 임시 폴더에 남긴다)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(import.meta.dirname, "..");
const dir = mkdtempSync(path.join(os.tmpdir(), "zapcut-mcp-"));
const v1 = path.join(dir, "v1.mp4");
const v2 = path.join(dir, "v2.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", v1]);
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", v2]);

const env = { APPDATA: process.env.APPDATA, PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
const client = new Client({ name: "zapcut-smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, "dist-electron/mcp.cjs")], env }));

async function call(name, args = {}) {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content.find((c) => c.type === "text")?.text;
  if (r.isError) throw new Error(`${name} 실패: ${text}`);
  console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    // 문자열 결과
  }
  return { data, img: r.content.find((c) => c.type === "image") };
}

console.log("도구:", (await client.listTools()).tools.map((t) => t.name).join(", "));
await call("new_project", { ratio: "16:9", short: 720, fps: 30, name: "MCP 점검" });
const [m1, m2] = (await call("import_media", { paths: [v1, v2] })).data.media;
const c1 = (await call("add_to_timeline", { media_id: m1.id, append: true })).data;
const c2 = (await call("add_to_timeline", { media_id: m2.id, append: true })).data;
await call("update_clip", { id: c1.clip_id, patch: { transition: { id: "fade", duration: 0.6 }, filter: { id: "portrait-glow", intensity: 1 } } });
await call("add_text", { content: "엽떡매니아", start: 0.5, duration: 3, y: 0.35, style: { fontSize: 96, runs: [{ start: 0, end: 2, color: "#ff3b3b", fontSize: 140 }] } });
const title = (await call("list_library", { kind: "titles" })).data[0];
await call("add_title", { template_id: title.id, start: 3.5, duration: 3, texts: ["짭컷", "MCP 점검"] });
const split = (await call("split_clip", { id: c2.clip_id, time: c2.start + 1 })).data;
await call("delete_clips", { ids: [split.right_id] });
await call("undo");
// 16:9 → 9:16, 1:1까지만 자르고 여백은 블러 (640×360 원본 → 좌우 각 21.9%를 자름)
const rf = (await call("reframe", { ratio: "9:16", fit: "box", anchor: "center" })).data;
if (rf.width !== 720 || rf.height !== 1280 || rf.cropped < 2) throw new Error(`reframe 결과가 다릅니다: ${JSON.stringify(rf)}`);
const state = (await call("get_state")).data;
if (!state.tracks.find((t) => t.main).clips.every((c) => Math.abs((c.crop?.l ?? 0) - 0.2188) < 1e-3 && c.canvas === "blur")) throw new Error("1:1 자르기 결과가 다릅니다");
console.log("포맷 변환:", `${rf.width}×${rf.height}, 자른 클립 ${rf.cropped}개, 텍스트 줄임 ${rf.shrunk}개`);
console.log("타임라인:", state.tracks.map((t) => `${t.kind}${t.main ? "(main)" : ""}: ${t.clips.map((c) => `${c.name}[${c.start.toFixed(1)}-${c.end.toFixed(1)}]`).join(" ")}`).join(" | "));
const shot = await call("screenshot", { time: 1 });
writeFileSync(path.join(dir, "shot.png"), Buffer.from(shot.img.data, "base64"));
const out = path.join(dir, "out.mp4");
await call("export", { path: out, resolution: 480, encoder: "libx264", quality: "low" });
const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", out], { encoding: "utf8" }));
console.log("내보내기:", `${info.format.duration}s`, info.streams.map((s) => `${s.codec_type}:${s.codec_name} ${s.width ?? ""}x${s.height ?? ""}`).join(", "));
await call("save_project", { path: path.join(dir, "smoke.zapcut") });
await client.close();
console.log(`\n모두 통과. 결과 폴더: ${dir}`);
