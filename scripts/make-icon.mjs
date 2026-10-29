// ZapCut 아이콘(build/icon.png, 512px)을 ffmpeg로 그린다: 청록 바탕 + 흰 번개 모양
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("build", { recursive: true });
// 번개 다각형을 가로 띠(drawbox) 여러 개로 근사하지 않고, geq로 직접 판정한다
const bolt = [
  [300, 40], [130, 290], [240, 290], [190, 472], [380, 210], [268, 210], [330, 40],
];
// 점-다각형 포함 판정(짝홀 규칙)을 geq 식으로 만든다
const edges = bolt.map((p, i) => [p, bolt[(i + 1) % bolt.length]]);
const terms = edges.map(([[x1, y1], [x2, y2]]) => `if(gt(${y1}\\,Y)-gt(${y2}\\,Y)\\,lt(X\\,(${x2}-${x1})*(Y-${y1})/(${y2}-${y1}+0.0001)+${x1})\\,0)`);
const inside = `mod(${terms.join("+")}\\,2)`;
// 둥근 모서리 사각형 마스크
const r = 110;
const rounded = `lte(hypot(max(${r}-X\\,max(X-${511 - r}\\,0))\\,max(${r}-Y\\,max(Y-${511 - r}\\,0)))\\,${r})`;
const R = `if(${rounded}\\,if(${inside}\\,255\\,18+X*0.03)\\,0)`;
const G = `if(${rounded}\\,if(${inside}\\,255\\,170+Y*0.08)\\,0)`;
const B = `if(${rounded}\\,if(${inside}\\,255\\,160+X*0.06)\\,0)`;
const A = `if(${rounded}\\,255\\,0)`;
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=512x512,format=rgba", "-vf", `geq=r='${R}':g='${G}':b='${B}':a='${A}'`, "-frames:v", "1", "build/icon.png"]);
console.log("build/icon.png 생성");
