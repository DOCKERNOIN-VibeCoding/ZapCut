// 무음 구간 잘라내기: 말소리 사이의 빈 구간을 찾아 모든 트랙(영상·소리·자막)에서 잘라내고 뒤를 당겨 붙인다 (인터뷰 템포 정리)
import { clipEnd, rippleDelete } from "../core/timeline";
import type { Clip, Project } from "../core/types";
import { useEditor } from "./store";

export interface SilenceOptions {
  noiseDb: number; // 기준 음량 (이보다 작으면 무음)
  minDur: number; // 최소 무음 길이(초)
  pad: number; // 말 앞뒤로 남길 여유(초)
}
export const DEFAULT_SILENCE: SilenceOptions = { noiseDb: -35, minDur: 0.6, pad: 0.15 };

/** 무음을 찾을 클립: 선택한 소리 있는 클립, 없으면 메인 트랙의 소리 있는 영상 (배경음악 트랙은 기준이 되지 않도록) */
export function silenceTargets(p: Project, selection: string[]): Clip[] {
  const audible = (c: Clip) => !c.muted && (c.kind === "audio" || (c.kind === "video" && !!p.media.find((m) => m.id === c.mediaId)?.hasAudio));
  const sel = p.tracks.flatMap((t) => t.clips).filter((c) => selection.includes(c.id) && audible(c));
  if (sel.length) return sel.sort((a, b) => a.start - b.start);
  return (p.tracks.find((t) => t.main)?.clips ?? []).filter(audible).sort((a, b) => a.start - b.start);
}

/** 겹치거나 붙은 구간을 합친다 */
export function mergeRanges(ranges: { a: number; b: number }[]) {
  const sorted = [...ranges].sort((x, y) => x.a - y.a);
  const out: { a: number; b: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.a <= last.b + 1e-6) last.b = Math.max(last.b, r.b);
    else out.push({ ...r });
  }
  return out;
}

export async function removeSilence(opts: SilenceOptions) {
  const s = useEditor.getState();
  const targets = silenceTargets(s.project, s.selection);
  if (!targets.length) return s.notify("소리가 있는 영상이나 오디오 클립을 고르거나 메인 트랙에 놓으세요", "error");
  s.setBusy("무음 구간 찾기");
  try {
    const ranges: { a: number; b: number }[] = [];
    for (const c of targets) {
      const media = s.project.media.find((m) => m.id === c.mediaId);
      if (!media) continue;
      const srcDur = c.duration * c.speed;
      const found = await window.zapcut.detectSilence({ path: media.path, start: c.in, duration: srcDur, noiseDb: opts.noiseDb, minDur: opts.minDur });
      for (const r of found) {
        // 클립 맨 앞·맨 끝의 무음은 여유 없이 끝까지 잘라낸다
        const a = r.start <= 0.01 ? c.start : Math.max(c.start, c.start + r.start / c.speed + opts.pad);
        const b = r.end >= srcDur - 0.01 ? clipEnd(c) : Math.min(clipEnd(c), c.start + r.end / c.speed - opts.pad);
        if (b - a >= 0.1) ranges.push({ a, b });
      }
    }
    const merged = mergeRanges(ranges);
    if (!merged.length) return useEditor.getState().notify("잘라낼 무음 구간이 없습니다. 기준 음량을 올리거나 최소 길이를 줄여 보세요");
    const total = merged.reduce((t, r) => t + (r.b - r.a), 0);
    // 뒤에서부터 잘라야 앞쪽 시각이 밀리지 않는다. 한 번의 커밋 → Ctrl+Z 한 번으로 되돌림
    useEditor.getState().commit((p) => [...merged].reverse().reduce((acc, r) => rippleDelete(acc, r.a, r.b), p));
    useEditor.getState().notify(`무음 ${merged.length}곳을 잘라 ${total.toFixed(1)}초 줄였습니다 (Ctrl+Z로 되돌릴 수 있습니다)`);
  } catch (e) {
    useEditor.getState().notify(`무음 구간 잘라내기 실패: ${(e as Error).message}`, "error");
  } finally {
    useEditor.getState().setBusy(undefined);
  }
}
