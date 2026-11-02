// 텍스트 → 딱 맞는 크기의 투명 캔버스. 미리보기 텍스처와 내보내기 PNG가 같은 함수를 쓴다.
// 크기는 기준 높이 Href(px)에서 fontSize * Href/1080 (클립 크기 배율은 레이어 변환에서 적용).
// runs(글자 범위별 색·크기)가 있으면 줄을 조각으로 나눠 조각마다 글꼴·색을 바꿔 이어 그린다.
import { linePieces, type TextPiece } from "./textRuns";
import type { TextStyle } from "./types";

export function fontString(s: TextStyle, px: number) {
  return `${s.italic ? "italic " : ""}${s.bold ? "800 " : "400 "}${px}px "${s.fontFamily}", "Pretendard", "Malgun Gothic", sans-serif`;
}

interface Piece extends TextPiece {
  px: number;
  width: number;
}
interface Line {
  pieces: Piece[];
  width: number;
  height: number;
}
interface Layout {
  px: number;
  lines: Line[];
  pad: number;
  textW: number;
  boxW: number;
  boxH: number;
}

function layout(ctx: CanvasRenderingContext2D, s: TextStyle, Href: number): Layout {
  const k = Href / 1080;
  const px = Math.max(1, s.fontSize * k);
  ctx.letterSpacing = `${(s.letterSpacing ?? 0) * k}px`;
  let maxPx = px;
  const lines = linePieces(s.content, s.runs).map((ps) => {
    const pieces = ps.map((p) => {
      const ppx = p.fontSize ? Math.max(1, p.fontSize * k) : px;
      ctx.font = fontString(s, ppx);
      maxPx = Math.max(maxPx, ppx);
      return { ...p, px: ppx, width: ctx.measureText(p.text).width };
    });
    // 줄 높이는 그 줄에서 가장 큰 글자 기준
    const linePx = Math.max(px, ...pieces.map((p) => p.px));
    return { pieces, width: pieces.reduce((a, p) => a + p.width, 0), height: linePx * (s.lineHeight ?? 1.25) };
  });
  const textW = Math.max(1, ...lines.map((l) => l.width));
  const effect = Math.max(s.strokeWidth * k * 2, (s.shadowBlur ?? 0) * k + Math.max(Math.abs(s.shadowX ?? 0), Math.abs(s.shadowY ?? 0)) * k, s.glow ? maxPx * 0.35 : 0);
  const pad = Math.ceil(maxPx * 0.3 + effect);
  return { px, lines, pad, textW, boxW: Math.ceil(textW + pad * 2), boxH: Math.ceil(lines.reduce((a, l) => a + l.height, 0) + pad * 2) };
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
  ctx.letterSpacing = `${(s.letterSpacing ?? 0) * k}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left"; // 조각을 이어 그리므로 시작점을 직접 계산한다
  if (s.background) {
    ctx.fillStyle = s.background;
    roundRect(ctx, 0, 0, L.boxW, L.boxH, (s.bgRadius ?? 0) * k);
    ctx.fill();
  }
  // 타자기: 앞에서부터 글자 수 제한
  const total = L.lines.reduce((a, l) => a + l.pieces.reduce((b, p) => b + [...p.text].length, 0), 0);
  let budget = Math.floor(total * Math.min(1, Math.max(0, fraction)) + 1e-6);
  let base: string | CanvasGradient = s.color;
  if (s.color2) {
    const gr = ctx.createLinearGradient(0, L.pad, 0, L.boxH - L.pad);
    gr.addColorStop(0, s.color);
    gr.addColorStop(1, s.color2);
    base = gr;
  }
  let yTop = L.pad;
  for (const line of L.lines) {
    const y = yTop + line.height / 2;
    yTop += line.height;
    const shown: Piece[] = [];
    for (const p of line.pieces) {
      if (budget <= 0) break;
      const chars = [...p.text];
      if (chars.length <= budget) {
        shown.push(p);
        budget -= chars.length;
      } else {
        const text = chars.slice(0, budget).join("");
        ctx.font = fontString(s, p.px);
        shown.push({ ...p, text, width: ctx.measureText(text).width });
        budget = 0;
      }
    }
    const w = shown.reduce((a, p) => a + p.width, 0);
    if (!w) continue;
    let x = s.align === "left" ? L.pad : s.align === "right" ? L.boxW - L.pad - w : (L.boxW - w) / 2;
    for (const p of shown) {
      if (!p.text) continue;
      ctx.font = fontString(s, p.px);
      if (s.glow) {
        ctx.save();
        ctx.shadowColor = s.glow;
        ctx.fillStyle = s.glow;
        for (const blur of [p.px * 0.35, p.px * 0.15]) {
          ctx.shadowBlur = blur;
          ctx.fillText(p.text, x, y);
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
        ctx.fillText(p.text, x, y);
        ctx.restore();
      }
      if (s.strokeWidth > 0) {
        ctx.lineJoin = "round";
        ctx.lineWidth = s.strokeWidth * k * 2;
        ctx.strokeStyle = s.strokeColor;
        ctx.strokeText(p.text, x, y);
      }
      ctx.fillStyle = p.color ?? base;
      ctx.fillText(p.text, x, y);
      x += p.width;
    }
  }
  return canvas;
}

/** 텍스트 상자 크기만 계산 */
export function measureTextBox(s: TextStyle, Href: number) {
  const c = document.createElement("canvas").getContext("2d")!;
  const L = layout(c, s, Href);
  return { w: L.boxW, h: L.boxH };
}
