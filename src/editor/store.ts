import { create } from "zustand";
import {
  clipEnd,
  clipFromMedia,
  editPoints,
  effectClip,
  findClip,
  mapClip,
  newProject,
  normalize,
  placeClip,
  projectDuration,
  removeClips,
  setSpeed,
  splitClip,
  textClip,
  trimAtPlayhead,
  uid,
} from "../core/timeline";
import { defaultParams, findEffect } from "../core/effects";
import { keyframeValue } from "../core/motion";
import { upgradeProject, type Clip, type KfProp, type Keyframe, type MediaItem, type Project, type Track, type Transition } from "../core/types";
import type { TextTemplate } from "../library/textTemplates";

/** T 근처 키가 있으면 값을 바꾸고, 없으면 새로 넣는다 */
function upsertKey(keys: Keyframe[], T: number, v: number): Keyframe[] {
  const i = keys.findIndex((k) => Math.abs(k.t - T) < 0.02);
  if (i >= 0) return keys.map((k, j) => (j === i ? { ...k, v } : k));
  return [...keys, { t: T, v, ease: "linear" as const }].sort((a, b) => a.t - b.t);
}
const baseValue = (c: Clip, prop: KfProp) => (prop === "volume" ? c.volume : c.transform[prop]);

const HISTORY_LIMIT = 200;

export type ResourceTab = "media" | "audio" | "text" | "sticker" | "effect" | "transition" | "filter" | "adjust" | "template";

interface EditorState {
  project: Project;
  filePath?: string;
  dirty: boolean;
  past: Project[];
  future: Project[];
  gestureBase?: Project;
  selection: string[];
  playhead: number;
  playing: boolean;
  zoom: number; // px / 초
  magnet: boolean;
  snapping: boolean;
  clipboard: Clip[];
  resourceTab: ResourceTab;
  importing: number;
  toast?: { text: string; kind: "info" | "error"; at: number };

  commit: (fn: (p: Project) => Project) => void;
  beginGesture: () => void;
  updateGesture: (fn: (p: Project) => Project) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  load: (project: Project, filePath?: string) => void;
  markSaved: (filePath: string) => void;
  notify: (text: string, kind?: "info" | "error") => void;

  select: (ids: string[]) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (v: boolean) => void;
  setZoom: (z: number) => void;
  setTab: (t: ResourceTab) => void;
  toggleMagnet: () => void;
  toggleSnapping: () => void;

  busy?: string;
  setBusy: (v?: string) => void;
  importFiles: (paths: string[], opts?: { keepAspect?: boolean; names?: string[]; sticker?: boolean }) => Promise<MediaItem[]>;
  valueAt: (clip: Clip, prop: KfProp, T: number) => number;
  setClipProps: (id: string, patch: Partial<Record<KfProp, number>>, transient?: boolean) => void;
  toggleKeyframe: (id: string, prop: KfProp) => void;
  clearKeyframes: (id: string, prop: KfProp) => void;
  setTransition: (clipId: string, t?: Transition) => void;
  addEffect: (effectId: string) => void;
  addAdjustLayer: () => void;
  applyTextTemplate: (t: TextTemplate) => void;
  addMediaToTimeline: (mediaId: string, start?: number, trackId?: string) => void;
  addText: (content?: string, patch?: Partial<Clip["text"]>) => void;
  updateClip: (id: string, fn: (c: Clip) => Clip) => void;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  changeSpeed: (id: string, speed: number) => void;
  splitAtPlayhead: () => void;
  deleteSelected: () => void;
  trimSide: (side: "left" | "right") => void;
  copy: () => void;
  paste: () => void;
  jumpEdit: (dir: -1 | 1) => void;
  setProjectProps: (patch: Partial<Pick<Project, "width" | "height" | "fps" | "background" | "name">>) => void;
  removeMedia: (id: string) => void;
}

export const useEditor = create<EditorState>((set, get) => {
  const apply = (p: Project) => normalize(p, get().magnet);

  return {
    project: newProject(),
    dirty: false,
    past: [],
    future: [],
    selection: [],
    playhead: 0,
    playing: false,
    zoom: 60,
    magnet: true,
    snapping: true,
    clipboard: [],
    resourceTab: "media",
    importing: 0,

    commit: (fn) => {
      const { project, past } = get();
      const next = apply(fn(project));
      if (next === project) return;
      set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true });
    },
    beginGesture: () => set({ gestureBase: get().project }),
    updateGesture: (fn) => {
      const base = get().gestureBase;
      if (!base) return;
      set({ project: apply(fn(base)) });
    },
    endGesture: () => {
      const { gestureBase, project, past } = get();
      if (!gestureBase) return;
      if (gestureBase === project) return set({ gestureBase: undefined });
      set({ gestureBase: undefined, past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [], dirty: true });
    },
    undo: () => {
      const { past, project, future } = get();
      if (!past.length) return;
      set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], dirty: true });
    },
    redo: () => {
      const { past, project, future } = get();
      if (!future.length) return;
      set({ project: future[0], future: future.slice(1), past: [...past, project], dirty: true });
    },
    load: (project, filePath) => set({ project: upgradeProject(project), filePath, past: [], future: [], selection: [], playhead: 0, playing: false, dirty: false }),
    markSaved: (filePath) => set({ filePath, dirty: false }),
    notify: (text, kind = "info") => set({ toast: { text, kind, at: Date.now() } }),

    select: (ids) => set({ selection: ids }),
    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
    setPlaying: (v) => set({ playing: v }),
    setZoom: (z) => set({ zoom: Math.min(400, Math.max(4, z)) }),
    setTab: (t) => set({ resourceTab: t }),
    toggleMagnet: () => {
      set({ magnet: !get().magnet });
      if (get().magnet) get().commit((p) => p);
    },
    toggleSnapping: () => set({ snapping: !get().snapping }),

    setBusy: (v) => set({ busy: v }),
    importFiles: async (paths, opts = {}) => {
      const added: MediaItem[] = [];
      set({ importing: get().importing + paths.length });
      for (const [i, file] of paths.entries()) {
        try {
          const existing = get().project.media.find((m) => m.path === file);
          if (existing) {
            added.push(existing);
            continue;
          }
          const info = await window.zapcut.probeMedia(file);
          const item: MediaItem = { ...info, id: uid("med"), name: opts.names?.[i] ?? info.name, sticker: opts.sticker || undefined };
          added.push(item);
          get().commit((p) => ({ ...p, media: [...p.media, item] }));
          // 미리보기로 재생할 수 없는 코덱이면 프록시를 백그라운드로 만든다
          if (await window.zapcut.needsProxy(item)) {
            get().notify(`미리보기용 프록시 생성 중: ${item.name}`);
            window.zapcut
              .makeProxy(item.path)
              .then((proxy) => {
                set({ project: { ...get().project, media: get().project.media.map((m) => (m.id === item.id ? { ...m, proxy } : m)) } });
                get().notify(`프록시 준비 완료: ${item.name}`);
              })
              .catch((e: Error) => get().notify(`프록시 생성 실패: ${e.message}`, "error"));
          }
          // 첫 비디오/이미지의 비율로 캔버스를 맞춘다
          const p = get().project;
          if (!opts.keepAspect && p.media.filter((m) => m.kind !== "audio" && !m.sticker).length === 1 && item.kind !== "audio" && item.width && item.height) {
            const h = 1080;
            const w = Math.round(((item.width / item.height) * h) / 2) * 2;
            set({ project: { ...p, width: w, height: h } });
          }
        } catch (e) {
          get().notify(`가져오기 실패: ${file.split(/[\\/]/).pop()} — ${(e as Error).message}`, "error");
        } finally {
          set({ importing: get().importing - 1 });
        }
      }
      return added;
    },

    addMediaToTimeline: (mediaId, start, trackId) => {
      const m = get().project.media.find((x) => x.id === mediaId);
      if (!m) return;
      const clip = clipFromMedia(m, start ?? get().playhead);
      get().commit((p) => {
        // 메인 트랙에 추가할 때 자석이 켜져 있으면 재생헤드 위치 뒤에 끼워 넣는다
        if (m.kind !== "audio" && !trackId && start === undefined) {
          const main = p.tracks.find((t) => t.main)!;
          const after = main.clips.find((c) => c.start < get().playhead && clipEnd(c) > get().playhead);
          const at = after ? clipEnd(after) - 0.001 : get().playhead;
          return placeClip(p, { ...clip, start: get().magnet ? at : get().playhead }, main.id);
        }
        return placeClip(p, clip, trackId);
      });
      set({ selection: [clip.id] });
    },

    addText: (content, patch) => {
      const c = textClip(get().playhead, content);
      if (patch && c.text) c.text = { ...c.text, ...patch };
      get().commit((p) => placeClip(p, c));
      set({ selection: [c.id] });
    },

    updateClip: (id, fn) => get().commit((p) => mapClip(p, id, fn)),
    updateTrack: (id, patch) => get().commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    changeSpeed: (id, speed) => get().commit((p) => setSpeed(p, id, speed)),

    splitAtPlayhead: () => {
      const { project, selection, playhead } = get();
      const ids = selection.length
        ? selection
        : project.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.filter((c) => playhead > c.start && playhead < clipEnd(c)).map((c) => c.id));
      if (!ids.length) return;
      const newSel: string[] = [];
      get().commit((p) => {
        let next = p;
        for (const id of ids) {
          const [res, right] = splitClip(next, id, playhead);
          next = res;
          if (right) newSel.push(right);
        }
        return next;
      });
      if (newSel.length) set({ selection: newSel });
    },

    deleteSelected: () => {
      const { selection } = get();
      if (!selection.length) return;
      get().commit((p) => removeClips(p, selection));
      set({ selection: [] });
    },

    trimSide: (side) => {
      const { project, selection, playhead } = get();
      const ids = selection.length
        ? selection
        : project.tracks.flatMap((t) => t.clips.filter((c) => playhead > c.start && playhead < clipEnd(c)).map((c) => c.id));
      get().commit((p) => ids.reduce((acc, id) => trimAtPlayhead(acc, id, playhead, side), p));
      if (side === "left" && get().magnet) {
        // 왼쪽 삭제 후 메인 트랙이 당겨지면 재생헤드를 잘린 클립 시작으로 이동
        const f = ids.map((id) => findClip(get().project, id)).find(Boolean);
        if (f?.track.main) set({ playhead: f.clip.start });
      }
    },

    copy: () => {
      const { project, selection } = get();
      const clips = selection.map((id) => findClip(project, id)?.clip).filter(Boolean) as Clip[];
      if (clips.length) set({ clipboard: clips });
    },
    paste: () => {
      const { clipboard, playhead } = get();
      if (!clipboard.length) return;
      const base = Math.min(...clipboard.map((c) => c.start));
      const pasted = clipboard.map((c) => ({ ...c, id: uid("clp"), start: playhead + (c.start - base) }));
      get().commit((p) => pasted.reduce((acc, c) => placeClip(acc, c, undefined, c.kind !== "audio" && c.kind !== "text"), p));
      set({ selection: pasted.map((c) => c.id) });
    },

    jumpEdit: (dir) => {
      const pts = editPoints(get().project);
      const t = get().playhead;
      const target = dir > 0 ? pts.find((x) => x > t + 1e-3) : [...pts].reverse().find((x) => x < t - 1e-3);
      if (target !== undefined) set({ playhead: target });
    },

    setProjectProps: (patch) => get().commit((p) => ({ ...p, ...patch })),

    valueAt: (clip, prop, T) => keyframeValue(clip.keyframes?.[prop], baseValue(clip, prop), T),

    // 키프레임이 있는 속성은 현재 시점의 키를, 없으면 기본값을 바꾼다
    setClipProps: (id, patch, transient) => {
      const fn = (p: Project) =>
        mapClip(p, id, (c) => {
          const T = Math.min(Math.max(0, get().playhead - c.start), c.duration);
          let next = c;
          for (const [prop, v] of Object.entries(patch) as [KfProp, number][]) {
            const keys = next.keyframes?.[prop];
            if (keys?.length) next = { ...next, keyframes: { ...next.keyframes, [prop]: upsertKey(keys, T, v) } };
            else if (prop === "volume") next = { ...next, volume: v };
            else next = { ...next, transform: { ...next.transform, [prop]: v } };
          }
          return next;
        });
      if (transient && get().gestureBase) get().updateGesture(fn);
      else get().commit(fn);
    },

    toggleKeyframe: (id, prop) => {
      const f = findClip(get().project, id);
      if (!f) return;
      const T = get().playhead - f.clip.start;
      if (T < 0 || T > f.clip.duration) return get().notify("재생헤드를 클립 안으로 옮긴 뒤 키프레임을 추가하세요");
      const keys = f.clip.keyframes?.[prop] ?? [];
      const at = keys.findIndex((k) => Math.abs(k.t - T) < 0.02);
      const nextKeys = at >= 0 ? keys.filter((_, i) => i !== at) : upsertKey(keys, T, get().valueAt(f.clip, prop, T));
      get().updateClip(id, (c) => ({ ...c, keyframes: { ...c.keyframes, [prop]: nextKeys } }));
    },

    clearKeyframes: (id, prop) =>
      get().updateClip(id, (c) => {
        // 지우기 전 현재 값을 기본값으로 남긴다
        const v = keyframeValue(c.keyframes?.[prop], baseValue(c, prop), Math.min(Math.max(0, get().playhead - c.start), c.duration));
        const kf = { ...c.keyframes };
        delete kf[prop];
        return prop === "volume" ? { ...c, volume: v, keyframes: kf } : { ...c, transform: { ...c.transform, [prop]: v }, keyframes: kf };
      }),

    setTransition: (clipId, t) => get().updateClip(clipId, (c) => ({ ...c, transition: t })),

    addEffect: (effectId) => {
      const def = findEffect(effectId);
      if (!def) return;
      const c = effectClip(get().playhead, "effect", { id: def.id, params: defaultParams(def) });
      get().commit((p) => placeClip(p, c));
      set({ selection: [c.id] });
    },

    addAdjustLayer: () => {
      const c = effectClip(get().playhead, "adjust");
      get().commit((p) => placeClip(p, c));
      set({ selection: [c.id] });
    },

    applyTextTemplate: (tt) => {
      const c = textClip(get().playhead, tt.content);
      c.text = { ...c.text!, ...tt.style };
      c.animIn = tt.animIn;
      c.animOut = tt.animOut;
      c.animLoop = tt.animLoop;
      c.duration = tt.duration ?? 3;
      c.transform = { ...c.transform, y: tt.y ?? 0.3 };
      get().commit((p) => placeClip(p, c));
      set({ selection: [c.id] });
    },
    removeMedia: (id) => get().commit((p) => ({ ...p, media: p.media.filter((m) => m.id !== id), tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.mediaId !== id) })) })),
  };
});

export const duration = () => projectDuration(useEditor.getState().project);
export const mediaUrl = (file: string) => `zapcut-media://f/${encodeURIComponent(file)}`;
