// 외부 제어(MCP) 명령 처리기. 메인의 제어 채널(electron/control.ts)이 control:call로 보낸 명령을 이름으로 찾아 실행한다.
// 도구 목록·입력 스키마는 electron/mcpTools.ts(브리지가 검사). 여기서는 스토어 액션과 코어 함수를 그대로 쓰므로
// 화면에서 한 편집과 같은 결과가 나오고 실행 취소도 같이 동작한다.
import { FILTER_PRESETS } from "../core/color";
import { EFFECTS } from "../core/effects";
import { outputSize, type ExportSettings, type VideoEncoder } from "../core/exportPlan";
import { findAnim, IN_ANIMS, LOOP_ANIMS, OUT_ANIMS } from "../core/motion";
import { canvasSize, clipEnd, findClip, mapClip, maxDuration, MIN_CLIP, moveClip, newProject, placeClip, projectDuration, RATIOS, removeClips, setSpeed, splitClip, textClip, TIERS } from "../core/timeline";
import { instantiateTitle, titleLabel } from "../core/titles";
import { TRANSITIONS } from "../core/transitions";
import type { Clip, MediaItem, Project } from "../core/types";
import { SOUNDS } from "../library/sounds";
import { STICKERS } from "../library/stickers";
import { TEMPLATES } from "../library/templates";
import { TEXT_TEMPLATES } from "../library/textTemplates";
import { TITLE_TEMPLATES } from "../library/titleTemplates";
import { renderTextAssets } from "./exportAssets";
import { useEditor } from "./store";

// 입력은 브리지가 zod로 검사하므로 여기서는 값의 의미(id 존재 등)만 확인한다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = Record<string, any>;
export type Handler = (args: Args) => unknown | Promise<unknown>;

const s = () => useEditor.getState();
const need = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const mediaSummary = (m: MediaItem) => ({ id: m.id, kind: m.kind, name: m.name, path: m.path, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio, sticker: m.sticker ?? false });

function clipSummary(c: Clip, p: Project) {
  const m = c.mediaId ? p.media.find((x) => x.id === c.mediaId) : undefined;
  return {
    id: c.id,
    kind: c.kind,
    mediaId: c.mediaId,
    name: c.title ? titleLabel(c.title) : (c.text?.content ?? c.effect?.id ?? m?.name),
    start: c.start,
    end: clipEnd(c),
    duration: c.duration,
    in: c.in,
    speed: c.speed,
    volume: c.volume,
    muted: c.muted,
    transform: c.transform,
    transition: c.transition,
    filter: c.filter?.id,
    title: c.title?.templateId,
    caption: c.caption,
    animIn: c.animIn?.id,
    animOut: c.animOut?.id,
    animLoop: c.animLoop?.id,
    crop: c.crop,
    canvas: c.canvas?.type,
  };
}

function stateSummary(full = false) {
  const st = s();
  const p = st.project;
  return {
    name: p.name,
    width: p.width,
    height: p.height,
    fps: p.fps,
    background: p.background,
    duration: projectDuration(p),
    filePath: st.filePath,
    dirty: st.dirty,
    playhead: st.playhead,
    playing: st.playing,
    selection: st.selection,
    busy: st.busy,
    importing: st.importing,
    magnet: st.magnet,
    media: p.media.map(mediaSummary),
    tracks: p.tracks.map(({ clips, ...t }) => ({ ...t, clips: clips.map((c) => (full ? c : clipSummary(c, p))) })),
  };
}

const anim = (id: string | undefined, kind: "in" | "out" | "loop") => {
  if (!id) return undefined;
  const a = findAnim(kind, id);
  need(a, `애니메이션을 찾을 수 없습니다: ${id} (list_library animations)`);
  return { id, duration: a!.defaultDuration };
};

// update_clip의 patch에서 그대로 덮어쓸 수 있는 키 (start·track_id·speed·transform·adjust·text는 따로 처리)
const CLIP_KEYS = ["duration", "in", "volume", "muted", "fadeIn", "fadeOut", "crop", "canvas", "filter", "lut", "transition", "animIn", "animOut", "animLoop", "flipH", "flipV", "blend", "chroma", "mask", "keyframes", "effect"];
const ENCODERS: VideoEncoder[] = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf"];

// ── 내보내기: 한 번에 하나. 진행률은 export_status로 본다 ──
interface ExportJob {
  running: boolean;
  progress: number;
  path: string;
  result?: { ok: boolean; path?: string; error?: string };
}
let job: ExportJob | undefined;
let unsubProgress: (() => void) | undefined;

async function runExport(path: string, settings: ExportSettings) {
  const p = s().project;
  const size = outputSize(p, settings.height);
  const pngs = renderTextAssets(p, size.height, settings.fps);
  job = { running: true, progress: 0, path };
  unsubProgress?.();
  unsubProgress = window.zapcut.onExportProgress((v) => {
    if (job) job.progress = v;
  });
  try {
    let r = await window.zapcut.startExport(p, settings, pngs, path);
    // GPU 인코더 실패 시 CPU로 재시도 (내보내기 창과 같은 규칙)
    if (!r.ok && settings.encoder !== "libx264" && !/취소/.test(r.error ?? "")) r = await window.zapcut.startExport(p, { ...settings, encoder: "libx264" }, pngs, path);
    job = { running: false, progress: r.ok ? 1 : job.progress, path, result: r };
    return r as { ok: boolean; path?: string; error?: string };
  } finally {
    unsubProgress?.();
    unsubProgress = undefined;
    if (job) job.running = false;
  }
}

export const handlers: Record<string, Handler> = {
  get_state: ({ full }) => stateSummary(!!full),

  get_clip: ({ id }) => {
    const f = findClip(s().project, id);
    need(f, `클립을 찾을 수 없습니다: ${id}`);
    return { track_id: f!.track.id, ...f!.clip };
  },

  new_project: ({ name, ratio, short, width, height, fps }) => {
    const r = RATIOS.find((x) => x.label === (ratio ?? "16:9")) ?? RATIOS[0];
    need(!short || TIERS.includes(short), `short는 ${TIERS.join("·")} 중 하나여야 합니다`);
    const size = width && height ? { width, height } : canvasSize(r.w, r.h, short ?? 1080);
    s().load(newProject(name || undefined, { ...size, fps: fps ?? 30 }));
    return stateSummary();
  },

  set_project: ({ name, width, height, fps, background }) => {
    s().setProjectProps(defined({ name, width, height, fps, background }));
    return stateSummary();
  },

  open_project: async ({ path }) => {
    const r = await window.zapcut.openProject(path);
    need(r, "프로젝트를 열지 못했습니다");
    s().load(r.project, r.filePath);
    return { ...stateSummary(), missing: r.missing as string[] };
  },

  save_project: async ({ path }) => {
    const st = s();
    const target = path ?? st.filePath;
    need(target, "저장 경로(path)를 지정하세요");
    const saved = await window.zapcut.saveProject(st.project, target);
    need(saved, "저장하지 못했습니다");
    st.markSaved(saved!);
    window.zapcut.autosave(newProject());
    return { path: saved };
  },

  import_media: async ({ paths, names }) => {
    const added = await s().importFiles(paths, { names });
    const failed = (paths as string[]).filter((p) => !added.some((m) => m.path === p));
    return { media: added.map(mediaSummary), failed };
  },

  add_to_timeline: ({ media_id, start, append, track_id }) => {
    const st = s();
    const m = st.project.media.find((x) => x.id === media_id);
    need(m, `미디어를 찾을 수 없습니다: ${media_id}`);
    const main = st.project.tracks.find((t) => t.main)!;
    let at: number | undefined = start;
    let track: string | undefined = track_id;
    if (append) {
      at = Math.max(0, ...main.clips.map(clipEnd));
      if (!track && m!.kind !== "audio") track = main.id;
    } else if (at !== undefined && !track && m!.kind !== "audio") track = main.id; // 시간을 줬으면 메인 트랙에
    st.addMediaToTimeline(media_id, at, track);
    const id = s().selection[0];
    const f = findClip(s().project, id);
    need(f, "클립을 놓지 못했습니다");
    return { clip_id: id, track_id: f!.track.id, ...clipSummary(f!.clip, s().project) };
  },

  add_text: ({ content, start, duration, style, x, y, scale, anim_in, anim_out, anim_loop }) => {
    const st = s();
    const c = textClip(start ?? st.playhead, content);
    if (style && c.text) c.text = { ...c.text, ...style };
    if (duration) c.duration = duration;
    const tf = { ...c.transform };
    if (x !== undefined) tf.x = x;
    if (y !== undefined) tf.y = y;
    if (scale !== undefined) tf.scale = scale;
    c.transform = tf;
    c.animIn = anim(anim_in, "in");
    c.animOut = anim(anim_out, "out");
    c.animLoop = anim(anim_loop, "loop");
    st.commit((p) => placeClip(p, c));
    st.select([c.id]);
    return { clip_id: c.id, ...clipSummary(c, s().project) };
  },

  add_title: ({ template_id, start, duration, texts, y }) => {
    const tt = TITLE_TEMPLATES.find((t) => t.id === template_id);
    need(tt, `타이틀 템플릿을 찾을 수 없습니다: ${template_id} (list_library titles)`);
    const title = { ...instantiateTitle(tt!), templateId: tt!.id };
    if (texts) {
      let i = 0;
      title.layers = title.layers.map((l) => (l.text && i < texts.length ? { ...l, text: { ...l.text, content: texts[i++] } } : l));
    }
    const st = s();
    const c = textClip(start ?? st.playhead, titleLabel(title));
    c.title = title;
    c.duration = duration ?? tt!.duration ?? 4;
    c.transform = { ...c.transform, y: y ?? tt!.y ?? 0 };
    st.commit((p) => placeClip(p, c));
    st.select([c.id]);
    return { clip_id: c.id, layers: title.layers.filter((l) => l.text).map((l) => ({ label: l.text!.label, content: l.text!.content })) };
  },

  list_library: ({ kind }) => {
    switch (kind) {
      case "titles":
        return TITLE_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, duration: t.duration ?? 4, texts: t.layers.filter((l) => l.text).map((l) => ({ label: l.text!.label, content: l.text!.content })) }));
      case "text_templates":
        return TEXT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, content: t.content }));
      case "transitions":
        return TRANSITIONS.map((t) => ({ id: t.id, name: t.name, category: t.category }));
      case "filters":
        return FILTER_PRESETS.map((f) => ({ id: f.id, name: f.name, category: f.category }));
      case "effects":
        return EFFECTS.map((e) => ({ id: e.id, name: e.name, category: e.category }));
      case "animations":
        return [...IN_ANIMS, ...OUT_ANIMS, ...LOOP_ANIMS].map((a) => ({ id: a.id, name: a.name, kind: a.kind, textOnly: a.textOnly ?? false }));
      case "stickers":
        return STICKERS.map((x) => ({ id: x.id, name: x.name, category: x.category }));
      case "sounds":
        return SOUNDS.map((x) => ({ id: x.id, name: x.name, category: x.category, duration: x.duration }));
      case "templates":
        return TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category, description: t.description, aspect: t.aspect, slots: t.slots, slotDuration: t.slotDuration }));
      case "fonts":
        return ["Pretendard", "Bebas Neue", "Pacifico"].map((name) => ({ name, bundled: true }));
      default:
        throw new Error(`알 수 없는 종류: ${kind}`);
    }
  },

  update_clip: ({ id, patch }) => {
    const st = s();
    const found = findClip(st.project, id);
    need(found, `클립을 찾을 수 없습니다: ${id}`);
    const { start, track_id, speed, transform, adjust, text, ...rest } = patch as Args;
    const unknown = Object.keys(rest).filter((k) => !CLIP_KEYS.includes(k));
    need(!unknown.length, `알 수 없는 속성: ${unknown.join(", ")}`);
    st.commit((p) => {
      let next = mapClip(p, id, (c) => {
        const m = c.mediaId ? p.media.find((x) => x.id === c.mediaId) : undefined;
        const n: Clip = { ...c, ...(rest as Partial<Clip>), transform: { ...c.transform, ...transform }, adjust: { ...c.adjust, ...adjust }, text: c.text && text ? { ...c.text, ...text } : c.text };
        if (rest.duration !== undefined) n.duration = Math.max(MIN_CLIP, Math.min(n.duration, maxDuration(n, m)));
        return n;
      });
      if (speed !== undefined) next = setSpeed(next, id, speed);
      if (start !== undefined || track_id) {
        const cur = findClip(next, id)!;
        next = moveClip(next, id, track_id ?? cur.track.id, start ?? cur.clip.start, st.magnet);
      }
      return next;
    });
    const after = findClip(s().project, id);
    need(after, "클립을 옮기지 못했습니다 (트랙 종류가 맞지 않음)");
    return { track_id: after!.track.id, ...clipSummary(after!.clip, s().project) };
  },

  delete_clips: ({ ids }) => {
    const st = s();
    st.commit((p) => removeClips(p, ids));
    st.select([]);
    return { deleted: ids };
  },

  split_clip: ({ id, time }) => {
    let right: string | undefined;
    s().commit((p) => {
      const [np, r] = splitClip(p, id, time);
      right = r;
      return np;
    });
    need(right, "그 시점에서 나눌 수 없습니다 (클립 범위 밖이거나 조각이 너무 짧음)");
    return { left_id: id, right_id: right };
  },

  set_playhead: ({ time }) => {
    s().setPlayhead(time);
    return { playhead: s().playhead };
  },

  select: ({ ids }) => {
    s().select(ids);
    return { selection: ids };
  },

  undo: () => {
    s().undo();
    return stateSummary();
  },

  redo: () => {
    s().redo();
    return stateSummary();
  },

  export: async ({ path, resolution, fps, quality, encoder, format, wait }) => {
    need(!job?.running, "이미 내보내기가 진행 중입니다 (export_status로 확인)");
    const p = s().project;
    const fmt: "mp4" | "mov" = format ?? (/\.mov$/i.test(path) ? "mov" : "mp4");
    const out: string = /\.(mp4|mov)$/i.test(path) ? path : `${path}.${fmt}`;
    const short = Math.min(p.width, p.height);
    const tier: number = resolution ?? TIERS.reduce((a, t) => (Math.abs(t - short) < Math.abs(a - short) ? t : a));
    need(TIERS.includes(tier), `resolution은 ${TIERS.join("·")} 중 하나여야 합니다`);
    let enc: VideoEncoder | undefined = encoder;
    if (!enc) {
      const list = await window.zapcut.encoders();
      enc = (list.find((e) => e !== "libx264" && (ENCODERS as string[]).includes(e)) ?? "libx264") as VideoEncoder;
    }
    const settings: ExportSettings = { height: canvasSize(p.width, p.height, tier).height, fps: fps ?? p.fps, quality: quality ?? "high", encoder: enc, format: fmt };
    const run = runExport(out, settings);
    if (wait === false) {
      run.catch(() => undefined);
      return { started: true, path: out, settings };
    }
    const r = await run;
    need(r.ok, `내보내기 실패: ${r.error}`);
    return { ok: true, path: out, settings };
  },

  export_status: () => job ?? { running: false },

  cancel_export: async () => {
    await window.zapcut.cancelExport();
    return { cancelled: true };
  },

  /** 화면 캡처용: 미리보기 캔버스가 창 안에서 차지하는 영역 (CSS px) */
  preview_rect: () => {
    const el = document.querySelector<HTMLCanvasElement>(".canvas-wrap canvas");
    if (!el) return undefined;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  },
};

/** 프리로드가 넘겨 주는 명령을 처리기에 연결한다 (앱 시작 시 한 번) */
export function installControl() {
  window.zapcut.onControl((name, args) => {
    const h = handlers[name];
    if (!h) throw new Error(`알 수 없는 명령: ${name}`);
    return h((args as Args) ?? {});
  });
}
