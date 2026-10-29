// 미리보기(캔버스)와 내보내기(FFmpeg)가 공유하는 기하/색 계산.
import type { Adjust, Clip, TextStyle, Transform } from "./types";

export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

/** 원본(srcW×srcH)을 캔버스에 맞춘(contain) 뒤 transform을 적용한 상자 */
export function mediaBox(srcW: number, srcH: number, W: number, H: number, t: Transform): Box {
  const fit = Math.min(W / srcW, H / srcH);
  return { cx: W / 2 + t.x * W, cy: H / 2 + t.y * H, w: srcW * fit * t.scale, h: srcH * fit * t.scale, rotation: t.rotation };
}

export const brightnessFactor = (a: Adjust) => 1 + a.brightness;
export const contrastFactor = (a: Adjust) => 1 + a.contrast;
export const saturationFactor = (a: Adjust) => 1 + a.saturation;

export function hasAdjust(a: Adjust) {
  return a.brightness !== 0 || a.contrast !== 0 || a.saturation !== 0;
}

/** CSS filter 문자열 (캔버스 미리보기용) */
export function cssFilter(a: Adjust) {
  if (!hasAdjust(a)) return "none";
  return `brightness(${brightnessFactor(a)}) contrast(${contrastFactor(a)}) saturate(${saturationFactor(a)})`;
}

/** 같은 연산의 FFmpeg 필터 (CSS filter 사양의 행렬과 동일) */
export function ffmpegAdjust(a: Adjust): string {
  if (!hasAdjust(a)) return "";
  const b = brightnessFactor(a);
  const c = contrastFactor(a);
  const s = saturationFactor(a);
  const lut = `clip((val*${b.toFixed(4)}-128)*${c.toFixed(4)}+128\\,0\\,255)`;
  const m = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ].map((v) => v.toFixed(4));
  return `lutrgb=r='${lut}':g='${lut}':b='${lut}',colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:br=${m[6]}:bg=${m[7]}:bb=${m[8]}`;
}

export function drawMedia(ctx: CanvasRenderingContext2D, src: CanvasImageSource, srcW: number, srcH: number, W: number, H: number, clip: Clip) {
  const box = mediaBox(srcW, srcH, W, H, clip.transform);
  ctx.save();
  ctx.globalAlpha = clip.transform.opacity;
  ctx.filter = cssFilter(clip.adjust);
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  ctx.drawImage(src, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

export function fontString(s: TextStyle, px: number) {
  return `${s.italic ? "italic " : ""}${s.bold ? "700 " : "400 "}${px}px "${s.fontFamily}", "Malgun Gothic", sans-serif`;
}

/** 텍스트 클립의 화면상 상자 (선택 핸들 표시용) */
export function measureText(ctx: CanvasRenderingContext2D, s: TextStyle, H: number, t: Transform) {
  const px = s.fontSize * (H / 1080) * t.scale;
  ctx.font = fontString(s, px);
  const lines = s.content.split("\n");
  const lineH = px * 1.25;
  const w = Math.max(1, ...lines.map((l) => ctx.measureText(l).width)) + px * 0.6;
  const h = lines.length * lineH + px * 0.3;
  return { px, lines, lineH, w, h };
}

export function drawText(ctx: CanvasRenderingContext2D, W: number, H: number, clip: Clip) {
  const s = clip.text;
  if (!s) return;
  const t = clip.transform;
  const { px, lines, lineH, w, h } = measureText(ctx, s, H, t);
  ctx.save();
  ctx.globalAlpha = t.opacity;
  ctx.translate(W / 2 + t.x * W, H / 2 + t.y * H);
  ctx.rotate((t.rotation * Math.PI) / 180);
  if (s.background) {
    ctx.fillStyle = s.background;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align;
  const x = s.align === "left" ? -w / 2 + px * 0.3 : s.align === "right" ? w / 2 - px * 0.3 : 0;
  lines.forEach((line, i) => {
    const y = -((lines.length - 1) * lineH) / 2 + i * lineH;
    if (s.strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = s.strokeWidth * (H / 1080) * t.scale * 2;
      ctx.strokeStyle = s.strokeColor;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
  return { w, h };
}
