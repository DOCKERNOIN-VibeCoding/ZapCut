import { create } from "zustand";
import {
  clipEnd,
  clipFromMedia,
  editPoints,
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
import type { Clip, MediaItem, Project, Track } from "../core/types";

const HISTORY_LIMIT = 200;

export type ResourceTab = "media" | "audio" | "text" | "sticker" | "effect" | "transition" | "filter" | "adjust";

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

  importFiles: (paths: string[]) => Promise<MediaItem[]>;
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
    load: (project, filePath) => set({ project, filePath, past: [], future: [], selection: [], playhead: 0, playing: false, dirty: false }),
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

    importFiles: async (paths) => {
      const added: MediaItem[] = [];
      set({ importing: get().importing + paths.length });
      for (const file of paths) {
        try {
          const existing = get().project.media.find((m) => m.path === file);
          if (existing) {
            added.push(existing);
            continue;
          }
          const info = await window.zapcut.probeMedia(file);
          const item: MediaItem = { ...info, id: uid("med") };
          added.push(item);
          get().commit((p) => ({ ...p, media: [...p.media, item] }));
          // 첫 비디오/이미지의 비율로 캔버스를 맞춘다
          const p = get().project;
          if (p.media.filter((m) => m.kind !== "audio").length === 1 && item.kind !== "audio" && item.width && item.height) {
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
    removeMedia: (id) => get().commit((p) => ({ ...p, media: p.media.filter((m) => m.id !== id), tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.mediaId !== id) })) })),
  };
});

export const duration = () => projectDuration(useEditor.getState().project);
export const mediaUrl = (file: string) => `zapcut-media://f/${encodeURIComponent(file)}`;
