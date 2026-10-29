// 타임라인 편집 연산 (순수 함수). 모든 함수는 새 Project를 반환한다.
import { DEFAULT_ADJUST, DEFAULT_TEXT, DEFAULT_TRANSFORM, type Clip, type MediaItem, type Project, type Track, type TrackKind } from "./types";

export const MIN_CLIP = 0.1;
export const IMAGE_DEFAULT = 5;
export const TEXT_DEFAULT = 3;

let counter = 0;
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const RATIOS: { label: string; w: number; h: number }[] = [
  { label: "16:9", w: 16, h: 9 },
  { label: "9:16", w: 9, h: 16 },
  { label: "1:1", w: 1, h: 1 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:4", w: 3, h: 4 },
  { label: "21:9", w: 21, h: 9 },
];

/** 해상도 등급 = 캔버스의 짧은 변 (4K는 16:9에서 3840×2160, 9:16에서 2160×3840) */
export const TIERS = [480, 720, 1080, 1440, 2160];
export const tierLabel = (short: number) => (short === 2160 ? "4K" : short === 1440 ? "2K" : `${short}p`);

/** 비율 w:h를 짧은 변 short로 키운 캔버스 크기 (짝수) */
export function canvasSize(w: number, h: number, short: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return w >= h ? { width: even((short * w) / h), height: even(short) } : { width: even(short), height: even((short * h) / w) };
}

export function newProject(name = "새 프로젝트", opts: Partial<Pick<Project, "width" | "height" | "fps" | "fitFirstMedia">> = {}): Project {
  return {
    version: 1,
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#000000",
    ...opts,
    media: [],
    tracks: [newTrack("video", true)],
  };
}

export function newTrack(kind: TrackKind, main = false, id = uid("trk")): Track {
  return { id, kind, main: main || undefined, clips: [], muted: false, hidden: false, locked: false };
}

export function clipEnd(c: Clip) {
  return c.start + c.duration;
}

export function projectDuration(p: Project) {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

/** 원본 미디어 길이 기준으로 이 클립이 타임라인에서 가질 수 있는 최대 길이 */
export function maxDuration(c: Clip, media?: MediaItem) {
  if (c.kind === "video" || c.kind === "audio") {
    if (!media || !media.duration) return Infinity;
    return (media.duration - c.in) / c.speed;
  }
  return Infinity;
}

export function clipFromMedia(m: MediaItem, start: number): Clip {
  const kind = m.kind === "image" ? "image" : m.kind;
  return {
    id: uid("clp"),
    kind,
    mediaId: m.id,
    start,
    duration: m.kind === "image" ? IMAGE_DEFAULT : m.duration,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    adjust: { ...DEFAULT_ADJUST },
  };
}

export function textClip(start: number, content?: string): Clip {
  return {
    id: uid("clp"),
    kind: "text",
    start,
    duration: TEXT_DEFAULT,
    in: 0,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM, y: 0.3 },
    adjust: { ...DEFAULT_ADJUST },
    text: { ...DEFAULT_TEXT, content: content ?? DEFAULT_TEXT.content },
  };
}

export function trackKindFor(clip: Clip): TrackKind {
  if (clip.kind === "effect" || clip.kind === "adjust") return "effect";
  return clip.kind === "audio" ? "audio" : clip.kind === "text" ? "text" : "video";
}

/** 효과/조정 레이어 클립 (효과 트랙에 놓임) */
export function effectClip(start: number, kind: "effect" | "adjust", effect?: Clip["effect"], duration = 3): Clip {
  return { ...textClip(start), text: undefined, kind, duration, transform: { ...DEFAULT_TRANSFORM }, effect };
}

const sortClips = (clips: Clip[]) => [...clips].sort((a, b) => a.start - b.start);

/** 메인 트랙 자석: 0초부터 빈틈 없이 순서대로 이어 붙인다. */
export function packTrack(track: Track): Track {
  let t = 0;
  const clips = sortClips(track.clips).map((c) => {
    const next = { ...c, start: t };
    t += c.duration;
    return next;
  });
  return { ...track, clips };
}

/** @param keepEmpty 드래그 중에는 빈 트랙을 남겨 트랙 줄 위치가 흔들리지 않게 한다 */
export function normalize(p: Project, magnet: boolean, keepEmpty = false): Project {
  const tracks = p.tracks
    .map((t) => (t.main && magnet ? packTrack(t) : { ...t, clips: sortClips(t.clips) }))
    // 메인 트랙이 아닌 빈 트랙은 제거
    .filter((t) => keepEmpty || t.main || t.clips.length > 0);
  return { ...p, tracks };
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

export function mapClip(p: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)) })) };
}

export function overlaps(track: Track, start: number, end: number, ignoreId?: string) {
  return track.clips.some((c) => c.id !== ignoreId && start < clipEnd(c) - 1e-6 && end > c.start + 1e-6);
}

/** 겹치지 않는 같은 종류의 트랙을 찾거나 새 트랙을 만들어 클립을 넣는다. */
export function placeClip(p: Project, clip: Clip, preferredTrackId?: string, forceNew = false, newTrackId?: string): Project {
  const kind = trackKindFor(clip);
  const tracks = [...p.tracks];
  const fits = (t: Track) => t.kind === kind && !t.locked && (t.main || !overlaps(t, clip.start, clipEnd(clip), clip.id));
  let target = forceNew ? undefined : tracks.find((t) => t.id === preferredTrackId && fits(t));
  if (!target && !forceNew && kind === "video") {
    const main = tracks.find((t) => t.main);
    if (main && main.clips.length === 0) target = main;
  }
  if (!target && !forceNew) target = tracks.find((t) => fits(t) && !t.main);
  if (!target) {
    const nt = newTrack(kind, false, newTrackId);
    target = nt;
    // 화면 배치: 효과 → 텍스트 → 오버레이 비디오 → 메인 → 오디오
    const mainIdx = tracks.findIndex((t) => t.main);
    if (kind === "audio") tracks.push(nt);
    else if (kind === "effect") tracks.unshift(nt);
    else if (kind === "text") tracks.splice(tracks.filter((t) => t.kind === "effect").length, 0, nt);
    else tracks.splice(Math.max(0, mainIdx), 0, nt);
  }
  const id = target.id;
  return { ...p, tracks: tracks.map((t) => (t.id === id ? { ...t, clips: [...t.clips, clip] } : t)) };
}

export function removeClips(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !set.has(c.id)) })) };
}

/** time 위치에서 클립을 둘로 나눈다. 성공하면 [project, 오른쪽 클립 id] */
export function splitClip(p: Project, clipId: string, time: number): [Project, string | undefined] {
  const found = findClip(p, clipId);
  if (!found) return [p, undefined];
  const { clip } = found;
  const offset = time - clip.start;
  if (offset < MIN_CLIP || clip.duration - offset < MIN_CLIP) return [p, undefined];
  const left: Clip = { ...clip, duration: offset, fadeOut: 0 };
  const right: Clip = {
    ...clip,
    id: uid("clp"),
    start: time,
    duration: clip.duration - offset,
    in: clip.in + offset * clip.speed,
    fadeIn: 0,
  };
  return [
    {
      ...p,
      tracks: p.tracks.map((t) => (t.id === found.track.id ? { ...t, clips: t.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])) } : t)),
    },
    right.id,
  ];
}

/** 재생헤드 기준 왼쪽(Q) 또는 오른쪽(W) 부분 삭제 */
export function trimAtPlayhead(p: Project, clipId: string, time: number, side: "left" | "right"): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const { clip } = found;
  const offset = time - clip.start;
  if (offset <= 0 || offset >= clip.duration) return p;
  if (side === "right") return mapClip(p, clipId, (c) => ({ ...c, duration: offset }));
  return mapClip(p, clipId, (c) => ({ ...c, start: time, duration: c.duration - offset, in: c.in + offset * c.speed }));
}

/** 가장자리 트림. edge=left면 시작점을, right면 끝점을 newTime으로 옮긴다. */
export function trimClip(p: Project, clipId: string, edge: "left" | "right", newTime: number): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const media = found.clip.mediaId ? p.media.find((m) => m.id === found.clip.mediaId) : undefined;
  return mapClip(p, clipId, (c) => {
    const end = clipEnd(c);
    if (edge === "right") {
      const dur = Math.min(Math.max(MIN_CLIP, newTime - c.start), maxDuration(c, media));
      return { ...c, duration: dur };
    }
    // 왼쪽: 원본 앞부분 이상으로 늘릴 수 없음 (in >= 0)
    const minStart = c.kind === "video" || c.kind === "audio" ? c.start - c.in / c.speed : -Infinity;
    const start = Math.min(Math.max(newTime, minStart, 0), end - MIN_CLIP);
    return { ...c, start, duration: end - start, in: Math.max(0, c.in + (start - c.start) * c.speed) };
  });
}

/** 배속 변경: 타임라인 길이도 비율에 맞게 바뀐다. */
export function setSpeed(p: Project, clipId: string, speed: number): Project {
  return mapClip(p, clipId, (c) => {
    const s = Math.min(10, Math.max(0.1, speed));
    return { ...c, speed: s, duration: Math.max(MIN_CLIP, (c.duration * c.speed) / s) };
  });
}

export interface MoveOptions {
  /** 드래그 중: 겹쳐도 겨냥한 트랙에 그대로 둔다 (놓을 때 resolveOverlap으로 정리) */
  allowOverlap?: boolean;
  /** "new" 트랙을 만들 때 쓸 고정 ID (드래그 중 매번 같은 트랙이 되도록) */
  newTrackId?: string;
}

/** 클립을 다른 트랙/시간으로 이동. 메인 트랙(자석)에서는 놓은 위치로 순서를 바꾼다. */
export function moveClip(p: Project, clipId: string, targetTrackId: string | "new", start: number, magnet: boolean, opts: MoveOptions = {}): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const clip = { ...found.clip, start: Math.max(0, start) };
  let next = removeClips(p, [clipId]);
  const compatible = (t?: Track) => !!t && t.kind === trackKindFor(clip) && !t.locked;
  let target = next.tracks.find((t) => t.id === targetTrackId);
  // 드래그 중 다른 종류의 트랙 위라면 원래 트랙에 머문다 (트랙을 새로 만들지 않음)
  if (opts.allowOverlap && targetTrackId !== "new" && !compatible(target)) target = next.tracks.find((t) => t.id === found.track.id);
  if (target && compatible(target)) {
    if (target.main && magnet) {
      // 놓은 클립의 시작점이 어느 클립의 중간점 앞에 있는지로 순서를 정한다
      const ordered = sortClips(target.clips);
      let idx = ordered.findIndex((c) => clip.start < c.start + c.duration / 2);
      if (idx < 0) idx = ordered.length;
      ordered.splice(idx, 0, clip);
      // 순서를 보존하기 위해 시작 시간을 순번으로 다시 매긴 뒤 pack
      const reindexed = ordered.map((c, i) => ({ ...c, start: i }));
      next = { ...next, tracks: next.tracks.map((t) => (t.id === target.id ? packTrack({ ...t, clips: reindexed }) : t)) };
      return next;
    }
    if (target.main || opts.allowOverlap || !overlaps(target, clip.start, clipEnd(clip))) {
      const id = target.id;
      return { ...next, tracks: next.tracks.map((t) => (t.id === id ? { ...t, clips: [...t.clips, clip] } : t)) };
    }
  }
  return placeClip(next, clip, undefined, targetTrackId === "new", opts.newTrackId);
}

/** 놓을 때: 클립이 같은 트랙의 다른 클립과 겹치면 그 트랙 바로 위에 새 트랙을 만들어 옮긴다 */
export function resolveOverlap(p: Project, clipId: string): Project {
  const found = findClip(p, clipId);
  if (!found || found.track.main || !overlaps(found.track, found.clip.start, clipEnd(found.clip), clipId)) return p;
  const tracks = removeClips(p, [clipId]).tracks;
  const idx = tracks.findIndex((t) => t.id === found.track.id);
  tracks.splice(idx, 0, { ...newTrack(found.track.kind), clips: [found.clip] });
  return { ...p, tracks };
}

/** 스냅 대상 시간들 (클립 경계 + 재생헤드) */
export function snapPoints(p: Project, excludeIds: string[], playhead: number): number[] {
  const ex = new Set(excludeIds);
  const pts = [0, playhead];
  for (const t of p.tracks) for (const c of t.clips) if (!ex.has(c.id)) pts.push(c.start, clipEnd(c));
  return pts;
}

export function snap(time: number, points: number[], threshold: number): number | undefined {
  let best: number | undefined;
  let bestD = threshold;
  for (const pt of points) {
    const d = Math.abs(pt - time);
    if (d <= bestD) {
      bestD = d;
      best = pt;
    }
  }
  return best;
}

/** 편집점(모든 클립 경계) 목록 — ↑/↓ 이동용 */
export function editPoints(p: Project): number[] {
  const s = new Set<number>([0]);
  for (const t of p.tracks) for (const c of t.clips) {
    s.add(+c.start.toFixed(4));
    s.add(+clipEnd(c).toFixed(4));
  }
  return [...s].sort((a, b) => a - b);
}

/** time 시점에 화면에 보이는 클립들 (합성 순서: 뒤 → 앞) */
export function visibleClipsAt(p: Project, time: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  const visualTracks = p.tracks.filter((t) => t.kind !== "audio" && !t.hidden);
  for (let i = visualTracks.length - 1; i >= 0; i--) {
    const track = visualTracks[i];
    for (const clip of track.clips) if (time >= clip.start && time < clipEnd(clip)) out.push({ clip, track });
  }
  return out;
}
