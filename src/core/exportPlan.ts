// 프로젝트 → FFmpeg 인자/필터 그래프 변환 (순수 함수)
// 합성 순서: 배경색 → 메인 트랙(전환 포함 시퀀스) → 위쪽 트랙들(오버레이/텍스트/효과)을 아래에서 위로.
import { bakeLut, clipColorFn, cubeText, type CubeLut } from "./color";
import { findEffect, defaultParams } from "./effects";
import { num, substitute } from "./expr";
import { hasMask, maskExpr } from "./mask";
import { maxOver, motionExprs, volumeExpr } from "./motion";
import { clipEnd, projectDuration } from "./timeline";
import { findTransition } from "./transitions";
import type { Clip, MediaItem, Project, Track } from "./types";

export type Quality = "high" | "medium" | "low";
export type VideoEncoder = "libx264" | "h264_nvenc" | "h264_qsv" | "h264_amf";

export interface ExportSettings {
  height: number; // 출력 세로 해상도 (가로는 프로젝트 비율로 계산)
  fps: number;
  quality: Quality;
  encoder: VideoEncoder;
  format: "mp4" | "mov";
}

/** 렌더러가 만든 텍스트 이미지. 타자기 애니메이션이면 여러 장(구간별) */
export interface TextAsset {
  w: number; // 출력 해상도 기준 픽셀
  h: number;
  frames: { file: string; from: number; to: number }[];
}

export interface ExportAssets {
  text: Record<string, TextAsset>;
  luts?: Record<string, CubeLut>; // 외부 .cube 경로 → 내용
}

export interface ExportPlan {
  args: string[]; // -filter_complex 경로는 FILTER_PLACEHOLDER로 들어 있음
  graph: string;
  files: { name: string; content: string }[]; // 작업 폴더에 써야 할 파일 (LUT 등)
  duration: number;
  width: number;
  height: number;
}

export const FILTER_PLACEHOLDER = "__FILTER_SCRIPT__";

export function outputSize(p: Project, height: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even((p.width / p.height) * height), height: even(height) };
}

/** atempo는 단계당 0.5~2.0 범위이므로 체인으로 나눈다 */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2) {
    out.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    out.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${+s.toFixed(6)}`);
  return out;
}

const n = (v: number) => +v.toFixed(6);
const hex = (c: string) => `0x${c.replace("#", "").slice(0, 6)}`;
const isConst = (e: string) => /^\(?-?[\d.]+\)?$/.test(e);
const constOf = (e: string) => Number(e.replace(/[()]/g, ""));

function encoderArgs(s: ExportSettings): string[] {
  const q = { high: 18, medium: 23, low: 28 }[s.quality];
  switch (s.encoder) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", String(q + 1), "-b:v", "0"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-global_quality", String(q + 1)];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", String(q), "-qp_p", String(q + 2)];
    default:
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(q)];
  }
}

class Graph {
  inputs: string[][] = [];
  lines: string[] = [];
  files: { name: string; content: string }[] = [];
  private seq = 0;
  input(args: string[]) {
    return this.inputs.push(args) - 1;
  }
  label(prefix = "x") {
    return `${prefix}${this.seq++}`;
  }
  add(line: string) {
    this.lines.push(line);
  }
}

interface Ctx {
  p: Project;
  s: ExportSettings;
  W: number;
  H: number;
  media: Map<string, MediaItem>;
  assets: ExportAssets;
  g: Graph;
}

/** 클립 색(LUT) 파일을 만들고 lut3d 필터를 돌려준다 */
function lutFilter(c: Ctx, clip: Clip): string | undefined {
  const ext = clip.lut && c.assets.luts?.[clip.lut.path];
  const fn = clipColorFn(clip, ext ? { lut: ext, intensity: clip.lut!.intensity } : undefined);
  if (!fn) return undefined;
  const name = `lut_${clip.id}.cube`;
  c.g.files.push({ name, content: cubeText(bakeLut(fn)) });
  return `lut3d=file=${name}:interp=trilinear`;
}

function clipExtras(clip: Clip): string[] {
  const out: string[] = [];
  if (clip.adjust.sharpen > 0) out.push(`unsharp=5:5:${n(clip.adjust.sharpen * 2.5)}:5:5:0`);
  if (clip.adjust.vignette > 0) out.push(`vignette=angle=${n(clip.adjust.vignette * 1.2)}`);
  return out;
}

interface LayerResult {
  label: string; // 처리된 레이어 스트림 (setpts로 시작 위치 OFFSET 적용 전)
  x: string; // overlay x 수식 (변수 t = 출력 시간)
  y: string;
}

/**
 * 시각 레이어 하나를 만든다.
 * @param T0 레이어 스트림 0초가 클립 내부 시간 몇 초인지 (전환 여유분이면 음수)
 * @param len 레이어 스트림 길이 (타임라인 초)
 * @param tOut 오버레이 시 출력 시간 → 레이어 스트림 시간 변환 오프셋 (overlay t - tOut = 스트림 시간)
 */
function buildLayer(c: Ctx, clip: Clip, T0: number, len: number, tOut: number): LayerResult | undefined {
  const { g, W, H, s } = c;
  const mo = motionExprs(clip);
  // 스트림 시간 τ → 클립 내부 시간 T = τ + T0
  const local = (e: string, v: string) => substitute(e, "T", `${v}+${num(T0)}`);
  let src: string;
  let srcW: number;
  let srcH: number;
  let native = false;
  const chain: string[] = [];

  if (clip.kind === "text") {
    const asset = c.assets.text[clip.id];
    if (!asset || !asset.frames.length) return undefined;
    srcW = asset.w;
    srcH = asset.h;
    native = true;
    if (asset.frames.length === 1) {
      const k = g.input(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(len)), "-i", asset.frames[0].file]);
      src = `[${k}:v]`;
    } else {
      const parts = asset.frames.map((fr) => {
        const k = g.input(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(Math.max(1 / s.fps, fr.to - fr.from))), "-i", fr.file]);
        return `[${k}:v]`;
      });
      const l = g.label("tw");
      g.add(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[${l}]`);
      src = `[${l}]`;
    }
    chain.push("format=rgba");
  } else {
    const m = clip.mediaId ? c.media.get(clip.mediaId) : undefined;
    if (!m) return undefined;
    srcW = m.width || W;
    srcH = m.height || H;
    if (clip.kind === "image") {
      const k = g.input(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(len)), "-i", m.path]);
      src = `[${k}:v]`;
      chain.push(`fps=${s.fps}`);
    } else {
      const srcStart = clip.in + T0 * clip.speed;
      const srcEnd = srcStart + len * clip.speed;
      const a = Math.max(0, srcStart);
      const b = m.duration ? Math.min(m.duration, srcEnd) : srcEnd;
      const k = g.input(["-ss", String(n(a)), "-t", String(n(Math.max(0.05, b - a))), "-i", m.path]);
      src = `[${k}:v]`;
      chain.push(`setpts=(PTS-STARTPTS)/${n(clip.speed)}`, `fps=${s.fps}`);
      const padStart = (a - srcStart) / clip.speed;
      const padEnd = (srcEnd - b) / clip.speed;
      if (padStart > 1e-3 || padEnd > 1e-3)
        chain.push(`tpad=start_duration=${n(Math.max(0, padStart))}:start_mode=clone:stop_duration=${n(Math.max(0, padEnd) + 0.1)}:stop_mode=clone`);
      chain.push(`trim=duration=${n(len)}`);
    }
    const cr = clip.crop;
    if (cr && (cr.l || cr.t || cr.r || cr.b)) {
      chain.push(`crop=iw*${n(1 - cr.l - cr.r)}:ih*${n(1 - cr.t - cr.b)}:iw*${n(cr.l)}:ih*${n(cr.t)}`);
      srcW *= 1 - cr.l - cr.r;
      srcH *= 1 - cr.t - cr.b;
    }
    if (clip.flipH) chain.push("hflip");
    if (clip.flipV) chain.push("vflip");
    chain.push("format=yuva444p", ...clipExtras(clip));
    if (clip.chroma?.enabled) chain.push(`chromakey=${hex(clip.chroma.color)}:${n(clip.chroma.similarity)}:${n(clip.chroma.blend)}`);
    chain.push("format=rgba");
    const lut = lutFilter(c, clip);
    if (lut) chain.push(lut);
  }

  // 마스크 (원본 해상도에서 계산 후 함께 크기 변경)
  let cur = g.label("L");
  g.add(`${src}${chain.join(",")}[${cur}]`);
  if (clip.mask && hasMask(clip.mask) && !native) {
    const mw = Math.max(2, Math.round(srcW));
    const mh = Math.max(2, Math.round(srcH));
    const mk = g.label("mk");
    g.add(`color=c=black:s=${mw}x${mh}:r=${s.fps}:d=${n(1 / s.fps)},format=gray,geq=lum='255*(${maskExpr(clip.mask)})',loop=loop=-1:size=1,trim=duration=${n(len)}[${mk}]`);
    const [l1, l2, la, am, out] = [g.label("ml"), g.label("ml"), g.label("ma"), g.label("mm"), g.label("L")];
    g.add(`[${cur}]split[${l1}][${l2}]`);
    g.add(`[${l2}]alphaextract[${la}]`);
    g.add(`[${la}][${mk}]blend=all_mode=multiply[${am}]`);
    g.add(`[${l1}][${am}]alphamerge[${out}]`);
    cur = out;
  }

  // 크기 → (고정 캔버스) → 회전 → 불투명도
  // 텍스트 PNG는 이미 출력 해상도로 렌더링됨 → 배율 1
  const fit = native ? 1 : Math.min(W / srcW, H / srcH);
  const w0 = native ? srcW : srcW * fit;
  const h0 = native ? srcH : srcH * fit;
  const post: string[] = [];
  const scaleE = mo.scale;
  if (isConst(scaleE)) {
    const k = constOf(scaleE);
    post.push(`scale=${Math.max(2, Math.round(w0 * k))}:${Math.max(2, Math.round(h0 * k))}`);
  } else {
    const maxS = Math.max(0.01, maxOver(scaleE, clip.duration));
    const mw = Math.max(2, Math.ceil(w0 * maxS) + 2);
    const mh = Math.max(2, Math.ceil(h0 * maxS) + 2);
    const se = local(scaleE, "t");
    post.push(`scale=w='max(2,${n(w0)}*(${se}))':h='max(2,${n(h0)}*(${se}))':eval=frame`);
    post.push(`pad=w=${mw}:h=${mh}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`);
  }
  const rotE = mo.rotation;
  if (!(isConst(rotE) && constOf(rotE) % 360 === 0)) {
    if (isConst(rotE)) {
      const a = n((constOf(rotE) * Math.PI) / 180);
      post.push(`rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`);
    } else {
      const maxS = isConst(scaleE) ? constOf(scaleE) : Math.max(0.01, maxOver(scaleE, clip.duration));
      const d = Math.ceil(Math.hypot(w0 * maxS, h0 * maxS)) + 4;
      post.push(`rotate=a='(${local(rotE, "t")})*PI/180':ow=${d}:oh=${d}:c=none`);
    }
  }
  const opE = mo.opacity;
  if (isConst(opE)) {
    if (constOf(opE) < 1) post.push(`colorchannelmixer=aa=${n(Math.max(0, constOf(opE)))}`);
  } else {
    // geq의 시간 변수는 T
    post.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${substitute(opE, "T", `T+${num(T0)}`)},0,1)'`);
  }
  const out = g.label("L");
  g.add(`[${cur}]${post.length ? post.join(",") : "null"}[${out}]`);

  const ov = (e: string, size: string, dim: number) => `${n(dim / 2)}+(${substitute(e, "T", `t-${num(tOut)}+${num(T0)}`)})*${dim}-${size}/2`;
  return { label: out, x: ov(mo.x, "overlay_w", W), y: ov(mo.y, "overlay_h", H) };
}

/** 메인 트랙: 클립마다 화면 전체 스트림을 만들고 전환(xfade)/연결(concat)로 잇는다 */
function buildMainTrack(c: Ctx, track: Track): { label: string; length: number } | undefined {
  const { g, W, H, s, p } = c;
  const clips = track.clips.filter((cl) => cl.kind === "video" || cl.kind === "image").sort((a, b) => a.start - b.start);
  if (!clips.length) return undefined;
  // 전환 길이: 인접(빈틈 없음)하고 양쪽 클립보다 짧을 때만
  const trans: (number | undefined)[] = clips.map((cl, i) => {
    const next = clips[i + 1];
    const def = findTransition(cl.transition?.id);
    if (!def || !next || Math.abs(next.start - clipEnd(cl)) > 0.01) return undefined;
    return Math.min(cl.transition!.duration, cl.duration * 0.9, next.duration * 0.9);
  });
  let acc: string | undefined;
  let accLen = 0;
  const colorSeg = (d: number) => {
    const l = g.label("gap");
    g.add(`color=c=${hex(p.background)}:s=${W}x${H}:r=${s.fps}:d=${n(d)},format=rgba,setsar=1[${l}]`);
    return l;
  };
  const concat = (a: string, b: string) => {
    const l = g.label("seq");
    g.add(`[${a}][${b}]concat=n=2:v=1:a=0[${l}]`);
    return l;
  };
  clips.forEach((cl, i) => {
    const head = i > 0 && trans[i - 1] ? trans[i - 1]! / 2 : 0;
    const tail = trans[i] ? trans[i]! / 2 : 0;
    const len = head + cl.duration + tail;
    // 빈틈 채우기
    const expectedStart = cl.start - head;
    if (expectedStart > accLen + 0.01) {
      const gap = colorSeg(expectedStart - accLen);
      acc = acc ? concat(acc, gap) : gap;
      accLen = expectedStart;
    }
    // 배경(캔버스) + 레이어
    const bg = cl.canvas?.type === "color" ? cl.canvas.color : p.background;
    const base = g.label("cv");
    g.add(`color=c=${hex(bg)}:s=${W}x${H}:r=${s.fps}:d=${n(len)},format=rgba[${base}]`);
    let under = base;
    if (cl.canvas?.type === "blur") {
      const m = cl.mediaId ? c.media.get(cl.mediaId) : undefined;
      if (m) {
        const k = cl.kind === "image" ? g.input(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(len)), "-i", m.path]) : g.input(["-ss", String(n(Math.max(0, cl.in - head * cl.speed))), "-t", String(n(len * cl.speed + 0.1)), "-i", m.path]);
        const bl = g.label("bl");
        const sigma = n(Math.max(1, cl.canvas.blur * 60 * (H / 1080)));
        g.add(`[${k}:v]setpts=(PTS-STARTPTS)/${n(cl.speed)},fps=${s.fps},tpad=stop_duration=${n(len)}:stop_mode=clone,trim=duration=${n(len)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=${sigma},format=rgba[${bl}]`);
        const u = g.label("cv");
        g.add(`[${base}][${bl}]overlay=0:0[${u}]`);
        under = u;
      }
    }
    const layer = buildLayer(c, cl, -head, len, 0);
    let seg = under;
    if (layer) {
      const o = g.label("seg");
      g.add(`[${under}][${layer.label}]overlay=x='${layer.x}':y='${layer.y}':eof_action=pass,trim=duration=${n(len)},setsar=1[${o}]`);
      seg = o;
    }
    if (!acc) {
      acc = seg;
      accLen = len;
    } else if (head > 0) {
      const def = findTransition(clips[i - 1].transition?.id)!;
      const d = trans[i - 1]!;
      const l = g.label("xf");
      g.add(`[${acc}][${seg}]xfade=transition=${def.xfade}:duration=${n(d)}:offset=${n(accLen - d)}[${l}]`);
      acc = l;
      accLen = accLen - d + len;
    } else {
      acc = concat(acc, seg);
      accLen += len;
    }
  });
  return acc ? { label: acc, length: accLen } : undefined;
}

/** 효과/조정 클립을 현재 합성 화면의 해당 구간에 적용 */
function applyEffectClip(c: Ctx, cur: string, clip: Clip): string {
  const { g, W, H, s } = c;
  let chain: string | undefined;
  if (clip.kind === "effect" && clip.effect) {
    const def = findEffect(clip.effect.id);
    if (!def) return cur;
    const prefix = g.label("e");
    chain = def
      .ffmpeg({ ...defaultParams(def), ...clip.effect.params }, { W, H, fps: s.fps, D: clip.duration })
      .replace(/\{p\}/g, prefix);
  } else if (clip.kind === "adjust") {
    const parts = ["format=yuva444p", ...clipExtras(clip), "format=rgba"];
    const lut = lutFilter(c, clip);
    if (lut) parts.push(lut);
    chain = `{in}${parts.join(",")}{out}`;
  }
  if (!chain) return cur;
  const st = n(clip.start);
  const en = n(clipEnd(clip));
  const [a, b, i, o, out] = [g.label("ea"), g.label("eb"), g.label("ei"), g.label("eo"), g.label("C")];
  g.add(`[${cur}]split[${a}][${b}]`);
  g.add(`[${b}]trim=start=${st}:end=${en},setpts=PTS-STARTPTS[${i}]`);
  g.add(chain.replace("{in}", `[${i}]`).replace("{out}", `,setpts=PTS+${st}/TB,format=rgba[${o}]`));
  g.add(`[${a}][${o}]overlay=eof_action=pass:enable='between(t,${st},${en})'[${out}]`);
  return out;
}

/** 블렌드 모드 합성 (A = 아래 화면, B = 레이어) */
function blendOver(c: Ctx, cur: string, layer: LayerResult, start: number, mode: string): string {
  const { g, W, H, s } = c;
  const total = projectDuration(c.p);
  const [cv, lf, l1, l2, la, b1, b2, b1g, l1g, bl, bla, out] = ["bc", "bf", "b1", "b2", "ba", "bA", "bB", "bAg", "bLg", "bm", "bma", "C"].map((x) => g.label(x));
  g.add(`color=c=black@0:s=${W}x${H}:r=${s.fps}:d=${n(total)},format=rgba[${cv}]`);
  g.add(`[${layer.label}]setpts=PTS+${n(start)}/TB[${layer.label}t]`);
  g.add(`[${cv}][${layer.label}t]overlay=x='${layer.x}':y='${layer.y}':eof_action=pass:format=rgb[${lf}]`);
  g.add(`[${lf}]split[${l1}][${l2}]`);
  g.add(`[${l2}]alphaextract[${la}]`);
  g.add(`[${cur}]split[${b1}][${b2}]`);
  g.add(`[${b1}]format=gbrp[${b1g}]`);
  g.add(`[${l1}]format=gbrp[${l1g}]`);
  g.add(`[${b1g}][${l1g}]blend=all_mode=${mode}[${bl}]`);
  g.add(`[${bl}]format=rgba[${bl}r]`);
  g.add(`[${bl}r][${la}]alphamerge[${bla}]`);
  g.add(`[${b2}][${bla}]overlay=0:0[${out}]`);
  return out;
}

export function buildExportPlan(p: Project, s: ExportSettings, assets: ExportAssets, outPath: string): ExportPlan {
  const { width: W, height: H } = outputSize(p, s.height);
  const total = Math.max(0.1, projectDuration(p));
  const g = new Graph();
  const c: Ctx = { p, s, W, H, media: new Map(p.media.map((m) => [m.id, m])), assets, g };

  g.input(["-f", "lavfi", "-i", `color=c=${hex(p.background)}:s=${W}x${H}:r=${s.fps}:d=${n(total)}`]);
  let cur = "C0";
  g.add(`[0:v]format=rgba[${cur}]`);

  const visual = p.tracks.filter((t) => t.kind !== "audio" && !t.hidden);
  for (let ti = visual.length - 1; ti >= 0; ti--) {
    const track = visual[ti];
    if (track.main) {
      const main = buildMainTrack(c, track);
      if (main) {
        const out = g.label("C");
        g.add(`[${cur}][${main.label}]overlay=0:0:eof_action=pass[${out}]`);
        cur = out;
      }
      continue;
    }
    for (const clip of track.clips) {
      if (clip.kind === "effect" || clip.kind === "adjust") {
        cur = applyEffectClip(c, cur, clip);
        continue;
      }
      if (clip.kind === "audio") continue;
      const layer = buildLayer(c, clip, 0, clip.duration, clip.start);
      if (!layer) continue;
      if (clip.blend && clip.blend !== "normal") {
        cur = blendOver(c, cur, layer, clip.start, clip.blend);
        continue;
      }
      const shifted = g.label("ls");
      g.add(`[${layer.label}]setpts=PTS+${n(clip.start)}/TB[${shifted}]`);
      const out = g.label("C");
      g.add(`[${cur}][${shifted}]overlay=x='${layer.x}':y='${layer.y}':eof_action=pass:enable='between(t,${n(clip.start)},${n(clipEnd(clip))})'[${out}]`);
      cur = out;
    }
  }
  g.add(`[${cur}]format=yuv420p[vout]`);

  // 오디오 믹스
  const audioLabels: string[] = [];
  const audible = (cl: Clip) => !cl.muted && (cl.volume > 0 || !!cl.keyframes?.volume?.length) && (cl.kind === "audio" || (cl.kind === "video" && c.media.get(cl.mediaId ?? "")?.hasAudio));
  for (const track of p.tracks) {
    if (track.muted || track.kind === "text" || track.kind === "effect") continue;
    for (const clip of track.clips) {
      if (!audible(clip)) continue;
      const m = c.media.get(clip.mediaId!)!;
      const k = g.input(["-ss", String(n(clip.in)), "-t", String(n(clip.duration * clip.speed)), "-i", m.path]);
      const label = g.label("a");
      const vol = volumeExpr(clip);
      const f = ["asetpts=PTS-STARTPTS", ...atempoChain(clip.speed), isConst(vol) ? `volume=${n(constOf(vol))}` : `volume='${substitute(vol, "T", "t")}':eval=frame`];
      if (clip.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`);
      if (clip.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, clip.duration - clip.fadeOut))}:d=${n(clip.fadeOut)}`);
      const ms = Math.round(clip.start * 1000);
      if (ms > 0) f.push(`adelay=${ms}:all=1`);
      g.add(`[${k}:a]${f.join(",")}[${label}]`);
      audioLabels.push(`[${label}]`);
    }
  }
  if (audioLabels.length === 0) {
    const k = g.input(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`]);
    g.add(`[${k}:a]atrim=0:${n(total)}[aout]`);
  } else {
    g.add(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,aresample=48000,apad[aout]`);
  }

  const args = [
    "-y", "-hide_banner", "-nostats", "-progress", "pipe:1",
    ...g.inputs.flat(),
    "-/filter_complex", FILTER_PLACEHOLDER,
    "-map", "[vout]", "-map", "[aout]",
    "-t", String(n(total)), "-r", String(s.fps),
    ...encoderArgs(s),
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    ...(s.format === "mp4" ? ["-movflags", "+faststart"] : []),
    outPath,
  ];
  return { args, graph: g.lines.join(";\n"), files: g.files, duration: total, width: W, height: H };
}
