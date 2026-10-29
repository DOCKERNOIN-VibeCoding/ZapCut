// 설치 파일에 넣을 ffmpeg/ffprobe를 build/ffmpeg 로 복사한다.
// 찾는 순서: ZAPCUT_FFMPEG_DIR → PATH 의 ffmpeg.exe
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const out = path.resolve("build/ffmpeg");
let dir = process.env.ZAPCUT_FFMPEG_DIR;
if (!dir) {
  const found = execFileSync("where", ["ffmpeg"], { encoding: "utf8" }).split(/\r?\n/).find(Boolean);
  if (!found) throw new Error("ffmpeg.exe 를 찾을 수 없습니다. ZAPCUT_FFMPEG_DIR 를 지정하세요.");
  dir = path.dirname(found);
}
mkdirSync(out, { recursive: true });
const files = [
  ["ffmpeg.exe", path.join(dir, "ffmpeg.exe")],
  ["ffprobe.exe", path.join(dir, "ffprobe.exe")],
  ["FFMPEG-LICENSE.txt", path.join(dir, "..", "LICENSE")],
];
for (const [name, src] of files) {
  if (!existsSync(src)) {
    if (name.endsWith(".exe")) throw new Error(`없음: ${src}`);
    continue;
  }
  const dest = path.join(out, name);
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  console.log(`복사: ${src} → ${dest}`);
}
console.log(execFileSync(path.join(out, "ffmpeg.exe"), ["-version"], { encoding: "utf8" }).split("\n")[0]);
