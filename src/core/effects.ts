// 비디오 효과 카탈로그. 효과는 "효과 트랙"의 클립으로 놓이며, 그 아래 합성된 화면 전체(영역 마스크가 있으면 그 안)에 적용된다.
// 각 효과는 FFmpeg 그래프 조각(ffmpeg)과 미리보기 셰이더(glsl, preview/shaders.ts의 kind 번호)를 짝으로 가진다.
// 그래프 조각 규칙: {in} 입력 라벨, {out} 출력 라벨, {p} 고유 접두어. 변수 t = 효과 클립 내부 시간.

export interface EffectParam {
  key: string;
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface EffectCtx {
  W: number;
  H: number;
  fps: number;
  D: number; // 효과 클립 길이
}

export interface EffectDef {
  id: string;
  name: string;
  category: string;
  params: EffectParam[];
  /** 미리보기 셰이더 종류 번호 */
  kind: number;
  ffmpeg: (p: Record<string, number>, c: EffectCtx) => string;
}

const P = (key: string, name: string, min: number, max: number, def: number, step = 0.01): EffectParam => ({ key, name, min, max, step, default: def });
const lin = (chain: string) => `{in}${chain}{out}`;
const f = (v: number) => +v.toFixed(5);

export const EFFECTS: EffectDef[] = [
  // ── 기본 ──
  { id: "blur", name: "흐림", category: "기본", kind: 1, params: [P("strength", "강도", 0, 1, 0.4)], ffmpeg: (p, c) => lin(`gblur=sigma=${f(Math.max(0.01, p.strength * 30 * (c.H / 1080)))}`) },
  { id: "vignette", name: "비네트", category: "기본", kind: 2, params: [P("strength", "강도", 0, 1, 0.5)], ffmpeg: (p) => lin(`vignette=angle=${f(Math.max(0.0001, p.strength * 1.2))}`) },
  { id: "grain", name: "필름 그레인", category: "기본", kind: 3, params: [P("strength", "강도", 0, 1, 0.4)], ffmpeg: (p) => lin(`noise=alls=${Math.round(p.strength * 40)}:allf=t+u`) },
  { id: "cover", name: "단색 가리기", category: "기본", kind: 50, params: [P("brightness", "밝기", 0, 1, 0)], ffmpeg: (p) => { const v = Math.round(p.brightness * 255); return lin(`lutrgb=r=${v}:g=${v}:b=${v}`); } },
  { id: "mosaic", name: "모자이크", category: "기본", kind: 4, params: [P("size", "블록 크기", 0, 1, 0.3)], ffmpeg: (p, c) => { const b = Math.max(2, Math.round((4 + p.size * 60) * (c.H / 1080))); return lin(`pixelize=width=${b}:height=${b}`); } },
  { id: "negate", name: "반전", category: "기본", kind: 5, params: [], ffmpeg: () => lin("negate") },
  { id: "posterize", name: "포스터", category: "기본", kind: 6, params: [P("levels", "단계", 2, 12, 4, 1)], ffmpeg: (p) => { const L = Math.round(p.levels); const e = `floor(val/256*${L})*255/${L - 1}`; return lin(`lutrgb=r='${e}':g='${e}':b='${e}'`); } },
  { id: "letterbox", name: "시네마 바", category: "기본", kind: 7, params: [P("size", "두께", 0, 0.3, 0.12)], ffmpeg: (p) => lin(`drawbox=x=0:y=0:w=iw:h=ih*${f(p.size)}:color=black:t=fill,drawbox=x=0:y=ih-ih*${f(p.size)}:w=iw:h=ih*${f(p.size)}:color=black:t=fill`) },
  { id: "sharpen", name: "선명하게", category: "기본", kind: 8, params: [P("strength", "강도", 0, 1, 0.5)], ffmpeg: (p) => lin(`unsharp=5:5:${f(p.strength * 2.5)}:5:5:0`) },
  // ── 카메라 ──
  { id: "shake", name: "흔들림", category: "카메라", kind: 10, params: [P("strength", "강도", 0, 1, 0.5), P("speed", "속도", 0.1, 3, 1)], ffmpeg: (p, c) => { const z = 1 + 0.12 * p.strength; return lin(`scale=${even(c.W * z)}:${even(c.H * z)},crop=${c.W}:${c.H}:x='(iw-ow)/2+(iw-ow)/2*sin(t*${f(53 * p.speed)})':y='(ih-oh)/2+(ih-oh)/2*sin(t*${f(71 * p.speed)})'`); } },
  { id: "handheld", name: "손떨림 카메라", category: "카메라", kind: 10, params: [P("strength", "강도", 0, 1, 0.4), P("speed", "속도", 0.02, 0.3, 0.08)], ffmpeg: (p, c) => { const z = 1 + 0.12 * p.strength; return lin(`scale=${even(c.W * z)}:${even(c.H * z)},crop=${c.W}:${c.H}:x='(iw-ow)/2+(iw-ow)/2*sin(t*${f(53 * p.speed)})':y='(ih-oh)/2+(ih-oh)/2*sin(t*${f(71 * p.speed)})'`); } },
  { id: "zoom-pulse", name: "줌 펄스", category: "카메라", kind: 11, params: [P("strength", "강도", 0, 1, 0.4), P("speed", "박자(초당)", 0.25, 4, 1)], ffmpeg: (p, c) => lin(`zoompan=z='1+${f(0.25 * p.strength)}*abs(sin(it*PI*${f(p.speed)}))':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${c.W}x${c.H}:fps=${c.fps}`) },
  { id: "ken-burns", name: "천천히 줌 인", category: "카메라", kind: 12, params: [P("strength", "확대량", 0, 1, 0.3)], ffmpeg: (p, c) => lin(`zoompan=z='1+${f(0.5 * p.strength)}*it/${f(Math.max(0.1, c.D))}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${c.W}x${c.H}:fps=${c.fps}`) },
  { id: "zoom-out-slow", name: "천천히 줌 아웃", category: "카메라", kind: 13, params: [P("strength", "축소량", 0, 1, 0.3)], ffmpeg: (p, c) => lin(`zoompan=z='1+${f(0.5 * p.strength)}*(1-it/${f(Math.max(0.1, c.D))})':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${c.W}x${c.H}:fps=${c.fps}`) },
  { id: "glitch", name: "글리치", category: "카메라", kind: 14, params: [P("strength", "강도", 0, 1, 0.5)], ffmpeg: (p, c) => { const z = 1.06; const a = f(0.5 * p.strength); return lin(`scale=${even(c.W * z)}:${even(c.H * z)},crop=${c.W}:${c.H}:x='(iw-ow)/2+(iw-ow)/2*${a}*lt(mod(t*7,1),0.25)*sin(t*97)*2':y='(ih-oh)/2',rgbashift=rh=${Math.round(p.strength * 12 * (c.H / 1080))}:bh=${-Math.round(p.strength * 12 * (c.H / 1080))},noise=alls=${Math.round(p.strength * 18)}:allf=t`); } },
  // ── 레트로 ──
  { id: "vhs", name: "VHS", category: "레트로", kind: 20, params: [P("strength", "강도", 0, 1, 0.6)], ffmpeg: (p, c) => { const s = Math.max(1, Math.round(p.strength * 6 * (c.H / 1080))); return lin(`rgbashift=rh=${s}:bh=${-s},noise=alls=${Math.round(p.strength * 16)}:allf=t,drawgrid=w=iw:h=${Math.max(2, Math.round(4 * (c.H / 1080)))}:t=1:c=black@${f(0.35 * p.strength)}`); } },
  { id: "old-film", name: "오래된 필름", category: "레트로", kind: 21, params: [P("strength", "강도", 0, 1, 0.7)], ffmpeg: (p) => { const k = p.strength; const m = (a: number, b: number) => f(a * k + b * (1 - k)); return lin(`colorchannelmixer=rr=${m(0.393, 1)}:rg=${m(0.769, 0)}:rb=${m(0.189, 0)}:gr=${m(0.349, 0)}:gg=${m(0.686, 1)}:gb=${m(0.168, 0)}:br=${m(0.272, 0)}:bg=${m(0.534, 0)}:bb=${m(0.131, 1)},noise=alls=${Math.round(k * 25)}:allf=t+u,vignette=angle=${f(0.6 * k + 0.0001)}`); } },
  { id: "rgb-split", name: "RGB 분리", category: "레트로", kind: 22, params: [P("strength", "거리", 0, 1, 0.4)], ffmpeg: (p, c) => { const s = Math.round(p.strength * 30 * (c.H / 1080)); return lin(`rgbashift=rh=${s}:bh=${-s}`); } },
  { id: "bw-flash", name: "흑백 깜빡임", category: "레트로", kind: 23, params: [P("speed", "속도", 0.25, 6, 2)], ffmpeg: (p) => lin(`hue=s='gte(sin(t*PI*2*${f(p.speed)}),0)'`) },
  { id: "scanline", name: "스캔라인", category: "레트로", kind: 24, params: [P("strength", "진하기", 0, 1, 0.4)], ffmpeg: (p, c) => lin(`drawgrid=w=iw:h=${Math.max(2, Math.round(3 * (c.H / 1080)))}:t=1:c=black@${f(0.6 * p.strength)}`) },
  // ── 아트 ──
  { id: "sketch", name: "스케치", category: "아트", kind: 30, params: [P("strength", "선 진하기", 0.2, 3, 1)], ffmpeg: (p) => lin(`format=gbrp,sobel=scale=${f(p.strength)},negate,hue=s=0`) },
  { id: "emboss", name: "엠보스", category: "아트", kind: 31, params: [], ffmpeg: () => { const k = "-2 -1 0 -1 1 1 0 1 2"; return lin(`format=gbrp,convolution='${k}:${k}:${k}:${k}:1:1:1:1:0:0:0:0'`); } },
  { id: "mirror", name: "좌우 대칭", category: "아트", kind: 32, params: [], ffmpeg: (_p, c) => `{in}crop=${even(c.W / 2)}:${c.H}:0:0,split[{p}l][{p}r];[{p}r]hflip[{p}rf];[{p}l][{p}rf]hstack,scale=${c.W}:${c.H}{out}` },
  { id: "split4", name: "4분할 화면", category: "아트", kind: 33, params: [], ffmpeg: (_p, c) => `{in}scale=${even(c.W / 2)}:${even(c.H / 2)},split[{p}a][{p}b];[{p}a][{p}b]hstack,split[{p}c][{p}d];[{p}c][{p}d]vstack,scale=${c.W}:${c.H}{out}` },
  { id: "hue-cycle", name: "무지개 색상", category: "아트", kind: 34, params: [P("speed", "속도(도/초)", 10, 360, 120, 1)], ffmpeg: (p) => lin(`hue=h='t*${f(p.speed)}'`) },
  { id: "duotone", name: "듀오톤", category: "아트", kind: 35, params: [P("hue", "색상", 0, 360, 280, 1)], ffmpeg: (p) => lin(`hue=s=0,colorchannelmixer=${duoMixer(p.hue)}`) },
  // ── 빛 ──
  { id: "glow", name: "빛 번짐", category: "빛", kind: 40, params: [P("strength", "강도", 0, 1, 0.5)], ffmpeg: (p, c) => `{in}split[{p}a][{p}b];[{p}b]gblur=sigma=${f(Math.max(0.5, 25 * (c.H / 1080)))}[{p}g];[{p}a][{p}g]blend=all_mode=screen:all_opacity=${f(p.strength)}{out}` },
  { id: "white-flash", name: "화이트 플래시", category: "빛", kind: 41, params: [P("strength", "밝기", 0, 1, 0.8), P("speed", "횟수(초당)", 0.25, 4, 1)], ffmpeg: (p) => lin(`eq=brightness='${f(p.strength)}*pow(max(0,sin(t*PI*${f(p.speed)})),8)':eval=frame`) },
  { id: "fade-black", name: "검정 페이드 인", category: "빛", kind: 42, params: [], ffmpeg: (_p, c) => lin(`fade=t=in:st=0:d=${f(c.D)}`) },
  { id: "fade-black-out", name: "검정 페이드 아웃", category: "빛", kind: 43, params: [], ffmpeg: (_p, c) => lin(`fade=t=out:st=0:d=${f(c.D)}`) },
  { id: "dream", name: "몽환 글로우", category: "빛", kind: 44, params: [P("strength", "강도", 0, 1, 0.6)], ffmpeg: (p, c) => `{in}split[{p}a][{p}b];[{p}b]gblur=sigma=${f(Math.max(0.5, 40 * (c.H / 1080)))}[{p}g];[{p}a][{p}g]blend=all_mode=lighten:all_opacity=${f(p.strength)}{out}` },
];

function even(v: number) {
  return Math.max(2, Math.round(v / 2) * 2);
}

/** 흑백 → 색조(hue) 두 톤: 어두운 쪽 검정, 밝은 쪽 해당 색 */
export function duoColor(hue: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const rgb: [number, number, number] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x];
  return rgb.map((v) => 0.25 + 0.75 * v) as [number, number, number];
}
function duoMixer(hue: number) {
  const [r, g, b] = duoColor(hue);
  // 흑백(r=g=b=L) 입력이므로 각 출력 채널 = L * 색
  return `rr=${f(r)}:rg=0:rb=0:gr=0:gg=${f(g)}:gb=0:br=0:bg=0:bb=${f(b)}`;
}

export const EFFECT_CATEGORIES = [...new Set(EFFECTS.map((e) => e.category))];
export const findEffect = (id?: string) => EFFECTS.find((e) => e.id === id);
export const defaultParams = (def: EffectDef) => Object.fromEntries(def.params.map((p) => [p.key, p.default]));
