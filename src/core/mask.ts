// 마스크 = FFmpeg 수식(변수 X, Y, W, H → 0..1). 내보내기는 geq로, 미리보기는 같은 수식을 expr.ts로 계산해 텍스처를 만든다.
import { num } from "./expr";
import type { Mask } from "./types";

const smooth = (e0: string, e1: string, x: string) => {
  const c = `clip((${x}-(${e0}))/((${e1})-(${e0})),0,1)`;
  return `(${c}*${c}*(3-2*${c}))`;
};

/** 마스크 값 수식 (1 = 보임) */
export function maskExpr(m: Mask): string {
  const M = "min(W,H)";
  const ux = `((X-W/2-${num(m.x)}*W)/${M})`;
  const uy = `((Y-H/2-${num(m.y)}*H)/${M})`;
  const a = (m.rotation * Math.PI) / 180;
  const c = num(Math.cos(a));
  const s = num(Math.sin(a));
  const rx = `(${ux}*${c}+${uy}*${s})`;
  const ry = `(${uy}*${c}-${ux}*${s})`;
  const fe = num(Math.max(0.002, m.feather * 0.5));
  const hw = num(Math.max(0.01, m.w / 2));
  const hh = num(Math.max(0.01, m.h / 2));
  let d: string;
  switch (m.type) {
    case "linear":
      d = ry;
      break;
    case "mirror":
      d = `(abs(${ry})-${hh})`;
      break;
    case "circle":
      d = `((hypot(${rx}/${hw},${ry}/${hh})-1)*${num(Math.min(m.w, m.h) / 2)})`;
      break;
    case "rect":
      d = `max(abs(${rx})-${hw},abs(${ry})-${hh})`;
      break;
    default:
      return "1";
  }
  const v = `(1-${smooth(`-${fe}`, fe, d)})`;
  return m.invert ? `(1-${v})` : v;
}

export const hasMask = (m?: Mask) => !!m && m.type !== "none";
