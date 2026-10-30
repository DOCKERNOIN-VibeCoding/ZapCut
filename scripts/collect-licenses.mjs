// 설치본에 들어가는 런타임 의존성의 라이선스를 licenses/THIRD-PARTY-NOTICES.txt 하나로 모은다.
// (빌드할 때마다 만들어 node_modules와 어긋나지 않게 한다. FFmpeg·Electron·글꼴은 따로 들어간다)
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "licenses", "THIRD-PARTY-NOTICES.txt");

const dirs = execSync("npm ls --omit=dev --all --parseable", { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .filter((d) => d && path.resolve(d) !== root && !/[\\/]@types[\\/]/.test(d));

const seen = new Set();
const parts = [];
for (const dir of [...new Set(dirs)].sort()) {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f));
  const text = file ? readFileSync(path.join(dir, file), "utf8").trim() : `(라이선스 파일 없음 — package.json: ${pkg.license ?? "미기재"})`;
  parts.push(`${"=".repeat(72)}\n${id} — ${pkg.license ?? ""}\n${pkg.homepage ?? ""}\n${"=".repeat(72)}\n\n${text}\n`);
}

if (!existsSync(path.dirname(out))) mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `ZapCut에 포함된 오픈 소스 소프트웨어 (${parts.length}개)\n\n${parts.join("\n")}`, "utf8");
console.log(`licenses: ${parts.length}개 패키지 → ${path.relative(root, out)}`);
