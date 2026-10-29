// 수식 해석기가 FFmpeg(libavutil/eval)와 같은 값을 내는지 aevalsrc로 대조한다
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { compile, substitute } from "../src/core/expr";
import { keyframeExpr, motionExprs, IN_ANIMS, LOOP_ANIMS, OUT_ANIMS } from "../src/core/motion";
import { clipFromMedia } from "../src/core/timeline";
import type { MediaItem } from "../src/core/types";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const RATE = 100;

/** FFmpeg로 expr(t)를 t = 0, 0.01, ... 에서 계산 */
function ffmpegEval(expr: string, duration: number): number[] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}':s=${RATE}:d=${duration}`, "-f", "f64le", "-c:a", "pcm_f64le", "-"], { maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const buf = r.stdout;
  return Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
}

function expectSame(expr: string, duration = 2) {
  const ff = ffmpegEval(expr, duration);
  const f = compile(expr);
  ff.forEach((v, i) => expect(f({ t: i / RATE })).toBeCloseTo(v, 6));
}

describe("수식 해석기 단독", () => {
  it("연산자 우선순위와 FFmpeg 규칙", () => {
    expect(compile("-2^2")({})).toBe(-4);
    expect(compile("2^3^2")({})).toBe(64); // 왼쪽 결합
    expect(compile("1+2*3-4/2")({})).toBe(5);
    expect(compile("mod(-1,3)")({})).toBe(2);
    expect(compile("if(lt(t,1),10,20)")({ t: 0.5 })).toBe(10);
    expect(compile("clip(5,0,1)")({})).toBe(1);
  });
  it("변수 치환", () => {
    expect(substitute("T*2+sin(T)", "T", "t-1")).toBe("(t-1)*2+sin((t-1))");
  });
});

describe.skipIf(!hasFfmpeg)("FFmpeg와 값 대조", () => {
  it("기본 함수", () => {
    expectSame("sin(t*3)*0.5+pow(t,2)-floor(t*1.5)+mod(t*7,3)");
    expectSame("if(lt(t,0.5),-t^2,hypot(t,1))+clip(t-1,0,0.5)+gte(t,1.2)");
  });

  it("키프레임 수식", () => {
    const e = keyframeExpr(
      [
        { t: 0.2, v: 0, ease: "easeInOut" },
        { t: 0.8, v: 1, ease: "easeOut" },
        { t: 1.3, v: -0.5, ease: "hold" },
        { t: 1.6, v: 2, ease: "linear" },
      ],
      0,
      "t",
    );
    expectSame(e);
  });

  it("모든 애니메이션 수식", () => {
    const m: MediaItem = { id: "m", kind: "image", path: "x.png", name: "x", duration: 0, width: 100, height: 100, fps: 30, hasAudio: false };
    const base = clipFromMedia(m, 0);
    const n = Math.max(IN_ANIMS.length, LOOP_ANIMS.length);
    for (let i = 0; i < n; i++) {
      const clip = {
        ...base,
        duration: 2,
        animIn: IN_ANIMS[i % IN_ANIMS.length] && { id: IN_ANIMS[i % IN_ANIMS.length].id, duration: 0.6 },
        animOut: { id: OUT_ANIMS[(i + 3) % OUT_ANIMS.length].id, duration: 0.5 },
        animLoop: { id: LOOP_ANIMS[i % LOOP_ANIMS.length].id, duration: 1.1 },
      };
      const mx = motionExprs(clip, "t");
      for (const e of [mx.x, mx.y, mx.scale, mx.rotation, mx.opacity]) expectSame(e, 2);
    }
  }, 60000);
});
