// MCP 브리지(electron/mcp.ts)를 Electron 없이 돌아가는 단일 Node 스크립트(dist-electron/mcp.cjs)로 묶는다.
// 묶여 들어간 패키지 목록을 dist-electron/mcp-packages.json에 적어 collect-licenses.mjs가 라이선스를 함께 모은다.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
mkdirSync(path.join(root, "dist-electron"), { recursive: true });

const r = await build({
  absWorkingDir: root,
  entryPoints: ["electron/mcp.ts"],
  outfile: "dist-electron/mcp.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  metafile: true,
  logLevel: "warning",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});

const dirs = new Set();
for (const f of Object.keys(r.metafile.inputs)) {
  const i = f.lastIndexOf("node_modules/");
  if (i < 0) continue;
  const rest = f.slice(i + "node_modules/".length).split("/");
  const name = rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  dirs.add(path.join(root, f.slice(0, i), "node_modules", name));
}
writeFileSync(path.join(root, "dist-electron/mcp-packages.json"), JSON.stringify([...dirs].sort(), null, 1));
console.log(`mcp: dist-electron/mcp.cjs (패키지 ${dirs.size}개 포함)`);
