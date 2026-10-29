// 색 엔진: 조정값 + 필터 프리셋 + 외부 LUT → 하나의 3D LUT.
// 미리보기(WebGL 3D 텍스처)와 내보내기(FFmpeg lut3d)가 같은 LUT를 쓰므로 색이 일치한다.
import { DEFAULT_ADJUST, type Adjust, type Clip } from "./types";

export type RGB = [number, number, number];
export const LUT_SIZE = 33;

export interface Look {
  adjust?: Partial<Adjust>;
  splitShadow?: { color: RGB; amount: number }; // 어두운 영역 색조
  splitHighlight?: { color: RGB; amount: number }; // 밝은 영역 색조
  gamma?: RGB; // 채널별 감마 (1 = 그대로)
  mono?: { tint?: RGB; amount?: number }; // 흑백(+색조)
  matrix?: number[]; // 3x3 채널 믹서 (행 우선)
  lift?: RGB; // 검정점 색
}

export interface FilterPreset {
  id: string;
  name: string;
  category: string;
  look: Look;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 사용자 조정 (모든 값 -1..1) */
export function applyAdjust([r, g, b]: RGB, a: Adjust): RGB {
  if (a.exposure) {
    const k = Math.pow(2, a.exposure * 2);
    r *= k;
    g *= k;
    b *= k;
  }
  if (a.temperature || a.tint) {
    r *= 1 + 0.18 * a.temperature;
    b *= 1 - 0.18 * a.temperature;
    g *= 1 - 0.12 * a.tint;
  }
  if (a.brightness) {
    const k = a.brightness * 0.35;
    r = k > 0 ? r + k * (1 - r) : r * (1 + k);
    g = k > 0 ? g + k * (1 - g) : g * (1 + k);
    b = k > 0 ? b + k * (1 - b) : b * (1 + k);
  }
  if (a.contrast) {
    const k = a.contrast > 0 ? 1 + a.contrast : 1 + a.contrast * 0.8;
    r = (r - 0.5) * k + 0.5;
    g = (g - 0.5) * k + 0.5;
    b = (b - 0.5) * k + 0.5;
  }
  if (a.highlights || a.shadows) {
    const L = clamp01(luma(r, g, b));
    const d = a.shadows * 0.3 * (1 - L) * (1 - L) + a.highlights * 0.3 * L * L;
    r += d;
    g += d;
    b += d;
  }
  if (a.saturation || a.vibrance) {
    const L = luma(r, g, b);
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const k = (1 + a.saturation) * (1 + a.vibrance * (1 - clamp01(sat)));
    r = L + (r - L) * k;
    g = L + (g - L) * k;
    b = L + (b - L) * k;
  }
  if (a.hue) {
    // YIQ 공간에서 색상 회전
    const ang = a.hue * Math.PI;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const i = 0.596 * r - 0.274 * g - 0.322 * b;
    const q = 0.211 * r - 0.523 * g + 0.312 * b;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const i2 = i * c - q * s;
    const q2 = i * s + q * c;
    r = y + 0.956 * i2 + 0.621 * q2;
    g = y - 0.272 * i2 - 0.647 * q2;
    b = y - 1.106 * i2 + 1.703 * q2;
  }
  if (a.fade) {
    const k = a.fade * 0.28;
    r = r * (1 - k) + k;
    g = g * (1 - k) + k;
    b = b * (1 - k) + k;
  }
  return [clamp01(r), clamp01(g), clamp01(b)];
}

export function applyLook(c: RGB, look: Look): RGB {
  let [r, g, b] = c;
  if (look.matrix) {
    const m = look.matrix;
    [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
  }
  if (look.mono) {
    const L = luma(r, g, b);
    const t = look.mono.tint ?? [1, 1, 1];
    const k = look.mono.amount ?? 1;
    r = mix(r, L * t[0], k);
    g = mix(g, L * t[1], k);
    b = mix(b, L * t[2], k);
  }
  if (look.gamma) {
    r = Math.pow(clamp01(r), 1 / look.gamma[0]);
    g = Math.pow(clamp01(g), 1 / look.gamma[1]);
    b = Math.pow(clamp01(b), 1 / look.gamma[2]);
  }
  if (look.splitShadow || look.splitHighlight) {
    const L = clamp01(luma(r, g, b));
    for (const [tone, w] of [
      [look.splitShadow, (1 - L) * (1 - L)],
      [look.splitHighlight, L * L],
    ] as const) {
      if (!tone) continue;
      const k = tone.amount * w;
      r = mix(r, r * (0.5 + tone.color[0]), k);
      g = mix(g, g * (0.5 + tone.color[1]), k);
      b = mix(b, b * (0.5 + tone.color[2]), k);
    }
  }
  if (look.lift) {
    r = r + look.lift[0] * (1 - r);
    g = g + look.lift[1] * (1 - g);
    b = b + look.lift[2] * (1 - b);
  }
  if (look.adjust) [r, g, b] = applyAdjust([r, g, b], { ...DEFAULT_ADJUST, ...look.adjust });
  return [clamp01(r), clamp01(g), clamp01(b)];
}

// ── 필터 프리셋 (짭컷 자체 조합) ───────────────────────────────
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

export const FILTER_PRESETS: FilterPreset[] = [
  // 인물
  { id: "portrait-glow", name: "화사함", category: "인물", look: { adjust: { brightness: 0.12, contrast: -0.05, saturation: 0.05, highlights: 0.1, temperature: 0.08 } } },
  { id: "portrait-milk", name: "우유빛", category: "인물", look: { adjust: { brightness: 0.15, contrast: -0.15, saturation: -0.15, fade: 0.25 }, splitHighlight: { color: hex("#fff2ea"), amount: 0.3 } } },
  { id: "portrait-peach", name: "복숭아", category: "인물", look: { adjust: { brightness: 0.08, temperature: 0.15, tint: -0.15, saturation: 0.05 }, splitHighlight: { color: hex("#ffd2c0"), amount: 0.35 } } },
  { id: "portrait-clear", name: "맑은 피부", category: "인물", look: { adjust: { exposure: 0.05, contrast: 0.05, saturation: -0.08, shadows: 0.2, temperature: -0.04 } } },
  { id: "portrait-rose", name: "로즈", category: "인물", look: { adjust: { tint: -0.2, saturation: 0.05, brightness: 0.05 }, splitShadow: { color: hex("#b5577a"), amount: 0.25 } } },
  // 풍경
  { id: "land-vivid", name: "비비드", category: "풍경", look: { adjust: { contrast: 0.15, saturation: 0.35, vibrance: 0.2 } } },
  { id: "land-sky", name: "푸른 하늘", category: "풍경", look: { adjust: { temperature: -0.15, saturation: 0.2, highlights: -0.15, contrast: 0.1 } } },
  { id: "land-forest", name: "숲", category: "풍경", look: { adjust: { saturation: 0.1, contrast: 0.1, hue: -0.03 }, splitShadow: { color: hex("#2f6b4a"), amount: 0.3 } } },
  { id: "land-sunset", name: "노을", category: "풍경", look: { adjust: { temperature: 0.35, saturation: 0.2, contrast: 0.1 }, splitHighlight: { color: hex("#ffb066"), amount: 0.35 } } },
  { id: "land-hdr", name: "HDR 느낌", category: "풍경", look: { adjust: { shadows: 0.45, highlights: -0.45, contrast: 0.2, vibrance: 0.3 } } },
  // 음식
  { id: "food-fresh", name: "신선함", category: "음식", look: { adjust: { brightness: 0.08, saturation: 0.25, temperature: 0.05, contrast: 0.08 } } },
  { id: "food-warm", name: "따뜻한 식탁", category: "음식", look: { adjust: { temperature: 0.25, saturation: 0.15, shadows: 0.1 } } },
  { id: "food-dessert", name: "디저트", category: "음식", look: { adjust: { brightness: 0.12, contrast: -0.1, saturation: 0.1, tint: -0.08, fade: 0.1 } } },
  // 영화
  { id: "film-teal-orange", name: "틸 앤 오렌지", category: "영화", look: { adjust: { contrast: 0.15, saturation: 0.05 }, splitShadow: { color: hex("#1f7f86"), amount: 0.55 }, splitHighlight: { color: hex("#ffa060"), amount: 0.45 } } },
  { id: "film-noir-blue", name: "블루 느와르", category: "영화", look: { adjust: { contrast: 0.25, saturation: -0.4, temperature: -0.3, brightness: -0.08 } } },
  { id: "film-bleach", name: "블리치 바이패스", category: "영화", look: { adjust: { contrast: 0.35, saturation: -0.55, highlights: 0.1 } } },
  { id: "film-matrix", name: "디지털 그린", category: "영화", look: { adjust: { contrast: 0.2, saturation: -0.2 }, gamma: [0.9, 1.12, 0.9] } },
  { id: "film-epic", name: "블록버스터", category: "영화", look: { adjust: { contrast: 0.3, shadows: -0.15, vibrance: 0.15 }, splitShadow: { color: hex("#24446e"), amount: 0.4 }, splitHighlight: { color: hex("#ffcf8a"), amount: 0.3 } } },
  { id: "film-moody", name: "무디", category: "영화", look: { adjust: { brightness: -0.12, contrast: 0.1, saturation: -0.25, fade: 0.2 }, splitShadow: { color: hex("#3b3355"), amount: 0.4 } } },
  // 레트로·필름
  { id: "retro-70s", name: "70년대", category: "레트로", look: { adjust: { saturation: -0.15, contrast: -0.05, fade: 0.3, temperature: 0.25 }, gamma: [1.05, 1, 0.85] } },
  { id: "retro-polaroid", name: "폴라로이드", category: "레트로", look: { adjust: { contrast: -0.1, fade: 0.35, saturation: -0.1 }, splitHighlight: { color: hex("#fff0c0"), amount: 0.4 }, splitShadow: { color: hex("#2b5b6b"), amount: 0.3 } } },
  { id: "retro-sepia", name: "세피아", category: "레트로", look: { matrix: SEPIA, adjust: { contrast: 0.05 } } },
  { id: "retro-kodak", name: "필름 웜", category: "레트로", look: { adjust: { contrast: 0.12, saturation: 0.08, temperature: 0.12 }, lift: [0.04, 0.03, 0.02], gamma: [1.04, 1, 0.94] } },
  { id: "retro-fuji", name: "필름 쿨", category: "레트로", look: { adjust: { contrast: 0.1, saturation: -0.05, tint: 0.08 }, gamma: [0.97, 1.03, 1.02], lift: [0.02, 0.04, 0.04] } },
  { id: "retro-cross", name: "크로스 프로세스", category: "레트로", look: { adjust: { contrast: 0.2, saturation: 0.2 }, gamma: [1.15, 1.08, 0.75] } },
  { id: "retro-vhs", name: "VHS 색감", category: "레트로", look: { adjust: { saturation: 0.25, contrast: -0.1, fade: 0.2, hue: 0.03 }, gamma: [1.06, 0.96, 1.05] } },
  // 흑백
  { id: "bw-classic", name: "클래식 흑백", category: "흑백", look: { mono: {}, adjust: { contrast: 0.1 } } },
  { id: "bw-high", name: "고대비 흑백", category: "흑백", look: { mono: {}, adjust: { contrast: 0.45, shadows: -0.1 } } },
  { id: "bw-soft", name: "부드러운 흑백", category: "흑백", look: { mono: {}, adjust: { contrast: -0.15, fade: 0.25 } } },
  { id: "bw-blue", name: "청색 모노", category: "흑백", look: { mono: { tint: hex("#b9d4ff") }, adjust: { contrast: 0.1 } } },
  { id: "bw-warm", name: "갈색 모노", category: "흑백", look: { mono: { tint: hex("#ffe1b8") }, adjust: { contrast: 0.08 } } },
  // 감성·파스텔
  { id: "mood-pastel", name: "파스텔", category: "감성", look: { adjust: { brightness: 0.12, contrast: -0.25, saturation: -0.2, fade: 0.3 }, lift: [0.04, 0.02, 0.06] } },
  { id: "mood-dreamy", name: "몽환", category: "감성", look: { adjust: { brightness: 0.1, contrast: -0.2, highlights: 0.2 }, splitHighlight: { color: hex("#ffd8f0"), amount: 0.4 }, splitShadow: { color: hex("#6a5acd"), amount: 0.3 } } },
  { id: "mood-lavender", name: "라벤더", category: "감성", look: { adjust: { tint: -0.2, temperature: -0.1, fade: 0.15 } } },
  { id: "mood-mint", name: "민트", category: "감성", look: { adjust: { tint: 0.15, temperature: -0.15, brightness: 0.05, saturation: -0.05 } } },
  { id: "mood-cafe", name: "카페", category: "감성", look: { adjust: { temperature: 0.18, contrast: -0.05, saturation: -0.15, fade: 0.18 } } },
  // 계절
  { id: "season-spring", name: "봄", category: "계절", look: { adjust: { brightness: 0.1, saturation: 0.1, tint: -0.1, temperature: 0.05 } } },
  { id: "season-summer", name: "여름", category: "계절", look: { adjust: { saturation: 0.3, contrast: 0.12, temperature: -0.05, brightness: 0.05 } } },
  { id: "season-autumn", name: "가을", category: "계절", look: { adjust: { temperature: 0.3, saturation: 0.1, hue: -0.04, contrast: 0.08 } } },
  { id: "season-winter", name: "겨울", category: "계절", look: { adjust: { temperature: -0.3, saturation: -0.2, brightness: 0.08, highlights: 0.1 } } },
  // 네온·사이버
  { id: "neon-cyber", name: "사이버펑크", category: "네온", look: { adjust: { contrast: 0.25, saturation: 0.3, tint: -0.25 }, splitShadow: { color: hex("#3a1ca8"), amount: 0.55 }, splitHighlight: { color: hex("#ff4fd8"), amount: 0.35 } } },
  { id: "neon-night", name: "네온 나이트", category: "네온", look: { adjust: { contrast: 0.2, saturation: 0.4, brightness: -0.05, temperature: -0.15 } } },
  { id: "neon-vapor", name: "베이퍼웨이브", category: "네온", look: { adjust: { saturation: 0.2, fade: 0.2 }, gamma: [1.12, 0.92, 1.15] } },
];

export const FILTER_CATEGORIES = [...new Set(FILTER_PRESETS.map((f) => f.category))];
export const findFilter = (id?: string) => FILTER_PRESETS.find((f) => f.id === id);

// ── LUT ────────────────────────────────────────────────────────
export interface CubeLut {
  size: number;
  data: Float32Array; // r가 가장 빠르게 변하는 순서, RGB
}

export function parseCube(text: string): CubeLut {
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^LUT_3D_SIZE\s+(\d+)/i.exec(line);
    if (m) {
      size = Number(m[1]);
      continue;
    }
    if (/^[A-Za-z_]/.test(line)) continue; // TITLE, DOMAIN_MIN 등
    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((v) => !Number.isNaN(v))) values.push(...parts);
  }
  if (!size || values.length !== size * size * size * 3) throw new Error("지원하지 않는 .cube 파일입니다 (3D LUT만 가능)");
  return { size, data: new Float32Array(values) };
}

/** 외부 LUT 삼선형 보간 */
export function sampleCube(lut: CubeLut, [r, g, b]: RGB): RGB {
  const n = lut.size - 1;
  const fr = clamp01(r) * n;
  const fg = clamp01(g) * n;
  const fb = clamp01(b) * n;
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(n, r0 + 1), g1 = Math.min(n, g0 + 1), b1 = Math.min(n, b0 + 1);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const S = lut.size;
  const at = (ri: number, gi: number, bi: number, ch: number) => lut.data[((bi * S + gi) * S + ri) * 3 + ch];
  const out: RGB = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c00 = mix(at(r0, g0, b0, ch), at(r1, g0, b0, ch), dr);
    const c10 = mix(at(r0, g1, b0, ch), at(r1, g1, b0, ch), dr);
    const c01 = mix(at(r0, g0, b1, ch), at(r1, g0, b1, ch), dr);
    const c11 = mix(at(r0, g1, b1, ch), at(r1, g1, b1, ch), dr);
    out[ch] = mix(mix(c00, c10, dg), mix(c01, c11, dg), db);
  }
  return out;
}

/** 클립의 색 파이프라인: 필터(강도) → 외부 LUT(강도) → 사용자 조정 */
export function clipColorFn(clip: Pick<Clip, "adjust" | "filter">, external?: { lut: CubeLut; intensity: number }): ((c: RGB) => RGB) | undefined {
  const preset = findFilter(clip.filter?.id);
  const k = clip.filter?.intensity ?? 1;
  const adj = { ...DEFAULT_ADJUST, ...clip.adjust };
  const hasAdj = (Object.keys(DEFAULT_ADJUST) as (keyof Adjust)[]).some((key) => key !== "sharpen" && key !== "vignette" && adj[key] !== 0);
  if (!preset && !external && !hasAdj) return undefined;
  return (c) => {
    let out = c;
    if (preset) {
      const f = applyLook(out, preset.look);
      out = [mix(out[0], f[0], k), mix(out[1], f[1], k), mix(out[2], f[2], k)];
    }
    if (external) {
      const f = sampleCube(external.lut, out);
      out = [mix(out[0], f[0], external.intensity), mix(out[1], f[1], external.intensity), mix(out[2], f[2], external.intensity)];
    }
    if (hasAdj) out = applyAdjust(out, adj);
    return out;
  };
}

export function bakeLut(fn: (c: RGB) => RGB, size = LUT_SIZE): CubeLut {
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const o = fn([r / (size - 1), g / (size - 1), b / (size - 1)]);
        data[i++] = o[0];
        data[i++] = o[1];
        data[i++] = o[2];
      }
  return { size, data };
}

export function cubeText(lut: CubeLut) {
  const lines = [`# ZapCut`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return lines.join("\n") + "\n";
}

/** UI용 미리보기 색: 기준 색상 견본에 필터를 적용한 CSS 그라데이션 */
export function presetSwatch(p: FilterPreset) {
  const samples: RGB[] = [hex("#e8b48a"), hex("#4f8fd6"), hex("#5fae6a"), hex("#30303a")];
  const css = samples.map((c) => {
    const o = applyLook(c, p.look);
    return `rgb(${Math.round(o[0] * 255)},${Math.round(o[1] * 255)},${Math.round(o[2] * 255)})`;
  });
  return `linear-gradient(135deg, ${css[0]} 0%, ${css[0]} 30%, ${css[1]} 30%, ${css[1]} 55%, ${css[2]} 55%, ${css[2]} 80%, ${css[3]} 80%)`;
}
