// 텍스트 → 딱 맞는 크기의 투명 캔버스. 미리보기 텍스처와 내보내기 PNG가 같은 함수를 쓴다.
// 크기는 기준 높이 Href(px)에서 fontSize * Href/1080 (클립 크기 배율은 레이어 변환에서 적용)
import type { TextStyle } from "./types";

export function fontString(s: TextStyle, px: number) {
  return `${s.italic ? "italic " : ""}${s.bold ? "800 " : "400 "}${px}px "${s.fontFamily}", "Malgun Gothic", sans-serif`;
}

interface Layout {
  px: number;
  lines: string[];
  lineH: number;
  pad: number;
  textW: number;
  boxW: number;
  boxH: number;
}

function layout(ctx: CanvasRenderingContext2D, s: TextStyle, Href: number): Layout {
  const k = Href / 1080;
  const px = Math.max(1, s.fontSize * k);
  ctx.font = fontString(s, px);
  ctx.letterSpacing = `${(s.letterSpacing ?? 0) * k}px`;
  const lines = s.content.split("\n");
  const lineH = px * (s.lineHeight ?? 1.25);
  const textW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const effect = Math.max(s.strokeWidth * k * 2, (s.shadowBlur ?? 0) * k + Math.max(Math.abs(s.shadowX ?? 0), Math.abs(s.shadowY ?? 0)) * k, s.glow ? px * 0.35 : 0);
  const pad = Math.ceil(px * 0.3 + effect);
  return { px, lines, lineH, pad, textW, boxW: Math.ceil(textW + pad * 2), boxH: Math.ceil(lines.length * lineH + pad * 2) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/**
 * @param fraction 타자기 효과: 보일 글자 비율 (상자 크기는 전체 글자 기준으로 고정)
 */
export function renderText(s: TextStyle, Href: number, fraction = 1, target?: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = target ?? document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const L = layout(ctx, s, Href);
  if (canvas.width !== L.boxW || canvas.height !== L.boxH) {
    canvas.width = L.boxW;
    canvas.height = L.boxH;
  } else ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = Href / 1080;
  ctx.font = fontString(s, L.px);
  ctx.letterSpacing = `${(s.letterSpacing ?? 0) * k}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = s.align;
  if (s.background) {
    ctx.fillStyle = s.background;
    roundRect(ctx, 0, 0, L.boxW, L.boxH, (s.bgRadius ?? 0) * k);
    ctx.fill();
  }
  // 타자기: 앞에서부터 글자 수 제한
  const total = L.lines.reduce((a, l) => a + [...l].length, 0);
  let budget = Math.floor(total * Math.min(1, Math.max(0, fraction)) + 1e-6);
  const shown = L.lines.map((l) => {
    const chars = [...l];
    const part = chars.slice(0, Math.max(0, budget)).join("");
    budget -= chars.length;
    return part;
  });
  const x = s.align === "left" ? L.pad : s.align === "right" ? L.boxW - L.pad : L.boxW / 2;
  const y0 = L.pad + L.lineH / 2;
  const fill = () => {
    if (s.color2) {
      const gr = ctx.createLinearGradient(0, L.pad, 0, L.boxH - L.pad);
      gr.addColorStop(0, s.color);
      gr.addColorStop(1, s.color2);
      return gr;
    }
    return s.color;
  };
  shown.forEach((line, i) => {
    if (!line) return;
    const y = y0 + i * L.lineH;
    if (s.glow) {
      ctx.save();
      ctx.shadowColor = s.glow;
      ctx.fillStyle = s.glow;
      for (const blur of [L.px * 0.35, L.px * 0.15]) {
        ctx.shadowBlur = blur;
        ctx.fillText(line, x, y);
      }
      ctx.restore();
    }
    if (s.shadowColor && (s.shadowBlur || s.shadowX || s.shadowY)) {
      ctx.save();
      ctx.shadowColor = s.shadowColor;
      ctx.shadowBlur = (s.shadowBlur ?? 0) * k;
      ctx.shadowOffsetX = (s.shadowX ?? 0) * k;
      ctx.shadowOffsetY = (s.shadowY ?? 0) * k;
      ctx.fillStyle = s.shadowColor;
      ctx.fillText(line, x, y);
      ctx.restore();
    }
    if (s.strokeWidth > 0) {
      ctx.lineJoin = "round";
      ctx.lineWidth = s.strokeWidth * k * 2;
      ctx.strokeStyle = s.strokeColor;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = fill();
    ctx.fillText(line, x, y);
  });
  return canvas;
}

/** 텍스트 상자 크기만 계산 */
export function measureTextBox(s: TextStyle, Href: number) {
  const c = document.createElement("canvas").getContext("2d")!;
  const L = layout(c, s, Href);
  return { w: L.boxW, h: L.boxH };
}
