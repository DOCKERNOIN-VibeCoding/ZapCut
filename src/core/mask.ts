// 마스크 = FFmpeg 수식(변수 X, Y, W, H → 0..1). 내보내기는 geq로, 미리보기는 같은 수식을 expr.ts로 계산해 텍스처를 만든다.
// 위치·크기·회전·페더는 키프레임을 줄 수 있다 (수식 안에서 T = 클립 내부 시간).
import { num } from "./expr";
import { keyframeExpr, keyframeValue } from "./motion";
import type { Clip, KfProp, Mask } from "./types";

/** 마스크 키프레임 속성 → Mask 필드 */
export const MASK_KF = { maskX: "x", maskY: "y", maskW: "w", maskH: "h", maskRotation: "rotation", maskFeather: "feather" } as const;
export type MaskKfProp = keyof typeof MASK_KF;
export const isMaskProp = (p: KfProp): p is MaskKfProp => p in MASK_KF;

const smooth = (e0: string, e1: string, x: string) => {
  const c = `clip((${x}-(${e0}))/((${e1})-(${e0})),0,1)`;
  return `(${c}*${c}*(3-2*${c}))`;
};

/** 마스크 값 수식 (1 = 보임). kf가 있으면 그 속성은 시간 T에 따라 변한다 */
export function maskExpr(m: Mask, kf?: Clip["keyframes"], T = "T"): string {
  const keys = (p: MaskKfProp) => kf?.[p];
  const f = (p: MaskKfProp) => keyframeExpr(keys(p), m[MASK_KF[p]], T);
  const M = "min(W,H)";
  const ux = `((X-W/2-${f("maskX")}*W)/${M})`;
  const uy = `((Y-H/2-${f("maskY")}*H)/${M})`;
  let c: string;
  let s: string;
  if (keys("maskRotation")?.length) {
    const a = `((${f("maskRotation")})*PI/180)`;
    c = `cos(${a})`;
    s = `sin(${a})`;
  } else {
    const a = (m.rotation * Math.PI) / 180;
    c = num(Math.cos(a));
    s = num(Math.sin(a));
  }
  const rx = `(${ux}*${c}+${uy}*${s})`;
  const ry = `(${uy}*${c}-${ux}*${s})`;
  const fe = `max(0.002,${f("maskFeather")}*0.5)`;
  const w = f("maskW");
  const h = f("maskH");
  const hw = `max(0.01,${w}/2)`;
  const hh = `max(0.01,${h}/2)`;
  let d: string;
  switch (m.type) {
    case "linear":
      d = ry;
      break;
    case "mirror":
      d = `(abs(${ry})-${hh})`;
      break;
    case "circle":
      d = `((hypot(${rx}/${hw},${ry}/${hh})-1)*min(${w},${h})/2)`;
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
export const maskAnimated = (c: Clip) => (Object.keys(MASK_KF) as MaskKfProp[]).some((p) => c.keyframes?.[p]?.length);

/** 시간 T의 마스크 (키프레임 반영, 미리보기·UI용) */
export function maskAt(c: Clip, T: number): Mask {
  const m = c.mask!;
  if (!maskAnimated(c)) return m;
  const out = { ...m };
  for (const p of Object.keys(MASK_KF) as MaskKfProp[]) out[MASK_KF[p]] = keyframeValue(c.keyframes?.[p], m[MASK_KF[p]], T);
  return out;
}
