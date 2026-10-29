// 프로젝트 → FFmpeg 인자/필터 그래프 변환 (순수 함수)
import { clipEnd, projectDuration } from "./timeline";
import { ffmpegAdjust, mediaBox } from "./render";
import type { Clip, MediaItem, Project } from "./types";

export type Quality = "high" | "medium" | "low";
export type VideoEncoder = "libx264" | "h264_nvenc" | "h264_qsv" | "h264_amf";

export interface ExportSettings {
  height: number; // 출력 세로 해상도 (가로는 프로젝트 비율로 계산)
  fps: number;
  quality: Quality;
  encoder: VideoEncoder;
  format: "mp4" | "mov";
}

export interface ExportPlan {
  args: string[]; // -filter_complex 경로는 FILTER_PLACEHOLDER로 들어 있음
  graph: string;
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

/**
 * @param textImages 텍스트 클립 id → 출력 해상도로 렌더링된 전체 화면 PNG 경로
 */
export function buildExportPlan(p: Project, s: ExportSettings, textImages: Record<string, string>, outPath: string): ExportPlan {
  const { width: W, height: H } = outputSize(p, s.height);
  const total = Math.max(0.1, projectDuration(p));
  const media = new Map<string, MediaItem>(p.media.map((m) => [m.id, m]));
  const inputs: string[][] = [];
  const graph: string[] = [];
  const addInput = (args: string[]) => inputs.push(args) - 1;

  addInput(["-f", "lavfi", "-i", `color=c=${p.background.replace("#", "0x")}:s=${W}x${H}:r=${s.fps}:d=${n(total)}`]);
  let cur = "[0:v]";
  let layer = 0;

  // 영상 합성: 아래쪽 트랙부터
  const visual = p.tracks.filter((t) => t.kind !== "audio" && !t.hidden);
  for (let ti = visual.length - 1; ti >= 0; ti--) {
    for (const clip of visual[ti].clips) {
      const label = `v${layer}`;
      const start = n(clip.start);
      const end = n(clipEnd(clip));
      if (clip.kind === "text") {
        const png = textImages[clip.id];
        if (!png) continue;
        const k = addInput(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(clip.duration)), "-i", png]);
        graph.push(`[${k}:v]format=rgba,setpts=PTS-STARTPTS+${start}/TB[${label}]`);
        graph.push(`${cur}[${label}]overlay=x=0:y=0:eof_action=pass:enable='between(t,${start},${end})'[o${layer}]`);
      } else {
        const m = clip.mediaId ? media.get(clip.mediaId) : undefined;
        if (!m || (clip.kind !== "video" && clip.kind !== "image")) continue;
        const k =
          clip.kind === "image"
            ? addInput(["-loop", "1", "-framerate", String(s.fps), "-t", String(n(clip.duration)), "-i", m.path])
            : addInput(["-ss", String(n(clip.in)), "-t", String(n(clip.duration * clip.speed)), "-i", m.path]);
        const box = mediaBox(m.width || W, m.height || H, W, H, clip.transform);
        const f = [`setpts=(PTS-STARTPTS)/${n(clip.speed)}`, `fps=${s.fps}`, `scale=${Math.max(2, Math.round(box.w))}:${Math.max(2, Math.round(box.h))}`, "format=rgba"];
        const adj = ffmpegAdjust(clip.adjust);
        if (adj) f.push(adj);
        if (clip.transform.rotation % 360 !== 0) {
          const a = n((clip.transform.rotation * Math.PI) / 180);
          f.push(`rotate=${a}:ow=rotw(${a}):oh=roth(${a}):c=none`);
        }
        if (clip.transform.opacity < 1) f.push(`colorchannelmixer=aa=${n(clip.transform.opacity)}`);
        f.push(`setpts=PTS+${start}/TB`);
        graph.push(`[${k}:v]${f.join(",")}[${label}]`);
        graph.push(
          `${cur}[${label}]overlay=x='${n(box.cx)}-overlay_w/2':y='${n(box.cy)}-overlay_h/2':eof_action=pass:enable='between(t,${start},${end})'[o${layer}]`,
        );
      }
      cur = `[o${layer}]`;
      layer++;
    }
  }
  graph.push(`${cur}format=yuv420p[vout]`);

  // 오디오 믹스
  const audioLabels: string[] = [];
  const audible = (c: Clip) => !c.muted && c.volume > 0 && (c.kind === "audio" || (c.kind === "video" && media.get(c.mediaId ?? "")?.hasAudio));
  for (const track of p.tracks) {
    if (track.muted || track.kind === "text") continue;
    for (const clip of track.clips) {
      if (!audible(clip)) continue;
      const m = media.get(clip.mediaId!)!;
      const k = addInput(["-ss", String(n(clip.in)), "-t", String(n(clip.duration * clip.speed)), "-i", m.path]);
      const label = `a${audioLabels.length}`;
      const f = ["asetpts=PTS-STARTPTS", ...atempoChain(clip.speed), `volume=${n(clip.volume)}`];
      if (clip.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(clip.fadeIn)}`);
      if (clip.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, clip.duration - clip.fadeOut))}:d=${n(clip.fadeOut)}`);
      const ms = Math.round(clip.start * 1000);
      if (ms > 0) f.push(`adelay=${ms}:all=1`);
      graph.push(`[${k}:a]${f.join(",")}[${label}]`);
      audioLabels.push(`[${label}]`);
    }
  }
  if (audioLabels.length === 0) {
    const k = addInput(["-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`]);
    graph.push(`[${k}:a]atrim=0:${n(total)}[aout]`);
  } else {
    graph.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,aresample=48000,apad[aout]`);
  }

  const args = [
    "-y",
    "-hide_banner",
    "-nostats",
    "-progress",
    "pipe:1",
    ...inputs.flat(),
    "-/filter_complex",
    FILTER_PLACEHOLDER,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-t",
    String(n(total)),
    "-r",
    String(s.fps),
    ...encoderArgs(s),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    ...(s.format === "mp4" ? ["-movflags", "+faststart"] : []),
    outPath,
  ];
  return { args, graph: graph.join(";\n"), duration: total, width: W, height: H };
}
