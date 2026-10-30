// 영상 클립이 화면(캔버스)에 놓인 자리: 캔버스 좌표 ↔ 원본 픽셀 좌표 (미리보기 layerBox·내보내기와 같은 규칙, 회전은 제외)
import { motionAt } from "./motion";
import type { Clip, MediaItem } from "./types";

export interface Placement {
  left: number; // 자른 뒤 원본이 그려지는 캔버스 위치·배율
  top: number;
  k: number;
  sw: number; // 자른 뒤 원본 크기
  sh: number;
  ox: number; // 자른 왼쪽·위 (원본 px)
  oy: number;
  flipH: boolean;
  flipV: boolean;
  rotation: number;
}

/** 클립 안 시간 T에서 W×H 캔버스에 놓인 자리 */
export function placement(c: Clip, m: MediaItem, T: number, W: number, H: number): Placement {
  const cr = c.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const sw = (m.width || W) * (1 - cr.l - cr.r);
  const sh = (m.height || H) * (1 - cr.t - cr.b);
  const mo = motionAt(c, T);
  const k = Math.min(W / sw, H / sh) * mo.scale;
  const cx = W / 2 + mo.x * W;
  const cy = H / 2 + mo.y * H;
  return { left: cx - (sw * k) / 2, top: cy - (sh * k) / 2, k, sw, sh, ox: cr.l * (m.width || W), oy: cr.t * (m.height || H), flipH: !!c.flipH, flipV: !!c.flipV, rotation: mo.rotation };
}

export function toSource(p: Placement, X: number, Y: number) {
  let x = (X - p.left) / p.k;
  let y = (Y - p.top) / p.k;
  if (p.flipH) x = p.sw - x;
  if (p.flipV) y = p.sh - y;
  return { x: x + p.ox, y: y + p.oy };
}

export function toCanvas(p: Placement, x: number, y: number) {
  let u = x - p.ox;
  let v = y - p.oy;
  if (p.flipH) u = p.sw - u;
  if (p.flipV) v = p.sh - v;
  return { X: p.left + u * p.k, Y: p.top + v * p.k };
}
