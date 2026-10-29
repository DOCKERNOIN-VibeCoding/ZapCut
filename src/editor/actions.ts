// 파일을 만들어야 하는 편집 동작 (스티커, 효과음, 정지 프레임, 역재생, 템플릿)
import { defaultParams, findEffect } from "../core/effects";
import { clipEnd, clipFromMedia, effectClip, findClip, newTrack, normalize, placeClip, splitClip, textClip, uid } from "../core/timeline";
import { DEFAULT_TRANSFORM, type Clip, type Keyframe, type MediaItem, type Project } from "../core/types";
import { SOUNDS } from "../library/sounds";
import { STICKERS, type StickerDef } from "../library/stickers";
import type { CameraMove, TemplateDef } from "../library/templates";
import { useEditor } from "./store";

const ed = () => useEditor.getState();

/** SVG → PNG data URL (렌더러에서) */
function svgToPng(svg: string, size = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d")!.drawImage(img, 0, 0, size, size);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("스티커 이미지를 만들 수 없습니다"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

async function stickerMedia(def: StickerDef): Promise<MediaItem | undefined> {
  const existing = ed().project.media.find((m) => m.sticker && m.name === def.name && m.path.includes(`sticker-${def.id}`));
  if (existing) return existing;
  const file = await window.zapcut.savePng(`sticker-${def.id}`, await svgToPng(def.svg));
  const [m] = await ed().importFiles([file], { keepAspect: true, names: [def.name], sticker: true });
  return m;
}

async function soundMedia(id: string): Promise<MediaItem | undefined> {
  const def = SOUNDS.find((s) => s.id === id);
  if (!def) return undefined;
  const file = await window.zapcut.generateSound(id);
  const [m] = await ed().importFiles([file], { keepAspect: true, names: [def.name] });
  return m;
}

const stickerClip = (m: MediaItem, start: number, duration: number, x: number, y: number, scale: number, loop?: string): Clip => ({
  ...clipFromMedia(m, start),
  duration,
  transform: { ...DEFAULT_TRANSFORM, x, y, scale },
  animIn: { id: "pop", duration: 0.4 },
  animOut: { id: "fade", duration: 0.3 },
  animLoop: loop ? { id: loop, duration: loop === "spin" ? 4 : 1.2 } : undefined,
});

async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  ed().setBusy(label);
  try {
    return await fn();
  } catch (e) {
    ed().notify(`${label} 실패: ${(e as Error).message}`, "error");
    return undefined;
  } finally {
    ed().setBusy(undefined);
  }
}

export async function addSticker(def: StickerDef) {
  await withBusy("스티커 추가", async () => {
    const m = await stickerMedia(def);
    if (!m) return;
    const c = stickerClip(m, ed().playhead, 3, 0, 0, 0.35);
    ed().commit((p) => placeClip(p, c, undefined, true));
    ed().select([c.id]);
  });
}

export async function addSound(id: string) {
  await withBusy("소리 추가", async () => {
    const m = await soundMedia(id);
    if (!m) return;
    const c = clipFromMedia(m, ed().playhead);
    ed().commit((p) => placeClip(p, c));
    ed().select([c.id]);
  });
}

/** 재생헤드 위치의 영상 프레임을 3초짜리 정지 화면으로 끼워 넣는다 */
export async function freezeFrame() {
  const s = ed();
  const t = s.playhead;
  const sel = s.selection.map((id) => findClip(s.project, id)).find((f) => f?.clip.kind === "video");
  const found = sel ?? s.project.tracks.filter((tr) => tr.kind === "video").flatMap((tr) => tr.clips.map((clip) => ({ track: tr, clip }))).find((f) => f.clip.kind === "video" && t > f.clip.start && t < clipEnd(f.clip));
  if (!found) return s.notify("정지 화면을 만들 영상 클립 위에 재생헤드를 두세요");
  const media = s.project.media.find((m) => m.id === found.clip.mediaId);
  if (!media) return;
  await withBusy("정지 화면", async () => {
    const png = await window.zapcut.freezeFrame(media.path, found.clip.in + (t - found.clip.start) * found.clip.speed);
    const [img] = await ed().importFiles([png], { keepAspect: true, names: [`${media.name} 정지 화면`] });
    if (!img) return;
    const { transition: _drop, keyframes: _kf, animIn: _ai, animOut: _ao, animLoop: _al, ...look } = found.clip;
    const freeze: Clip = { ...look, id: uid("clp"), kind: "image", mediaId: img.id, start: t - 0.0005, duration: 3, in: 0, speed: 1 };
    ed().commit((p) => {
      const [split] = splitClip(p, found.clip.id, t);
      if (found.track.main && ed().magnet) return placeClip(split, freeze, found.track.id);
      return placeClip(split, { ...freeze, start: t }, undefined, true);
    });
    ed().select([freeze.id]);
  });
}

/** 클립 구간을 역재생 파일로 바꾼다 */
export async function reverseClip(id: string) {
  const f = findClip(ed().project, id);
  if (!f || f.clip.kind !== "video") return ed().notify("영상 클립을 선택하세요");
  const media = ed().project.media.find((m) => m.id === f.clip.mediaId);
  if (!media) return;
  await withBusy("역재생 만들기", async () => {
    const out = await window.zapcut.reverseRange(media.path, f.clip.in, f.clip.duration * f.clip.speed, media.hasAudio);
    const [rev] = await ed().importFiles([out], { keepAspect: true, names: [`${media.name} (역재생)`] });
    if (rev) ed().updateClip(id, (c) => ({ ...c, mediaId: rev.id, in: 0 }));
  });
}

export async function importLut(clipId: string) {
  const file = await window.zapcut.pickCube();
  if (!file) return;
  const lut = await window.zapcut.readCube(file);
  if (!lut) return ed().notify("지원하지 않는 .cube 파일입니다", "error");
  ed().updateClip(clipId, (c) => ({ ...c, lut: { path: file, name: file.split(/[\\/]/).pop()!, intensity: 1 } }));
}

// ── 템플릿 ─────────────────────────────────────────────
const ASPECTS = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] } as const;

function cameraKeys(move: CameraMove | undefined, i: number, d: number): Clip["keyframes"] {
  const lin = (a: number, b: number): Keyframe[] => [
    { t: 0, v: a, ease: "linear" },
    { t: d, v: b, ease: "linear" },
  ];
  const m = move === "alternate" ? (i % 2 ? "zoom-out" : "zoom-in") : move;
  switch (m) {
    case "zoom-in":
      return { scale: lin(1, 1.15) };
    case "zoom-out":
      return { scale: lin(1.15, 1) };
    case "pan-left":
      return { scale: lin(1.15, 1.15), x: lin(0.05, -0.05) };
    case "pan-right":
      return { scale: lin(1.15, 1.15), x: lin(-0.05, 0.05) };
    default:
      return undefined;
  }
}

export async function applyTemplate(def: TemplateDef) {
  const s = ed();
  const sources = s.project.media.filter((m) => (m.kind === "video" || m.kind === "image") && !m.sticker);
  if (!sources.length) return s.notify("먼저 사진이나 동영상을 가져오세요. 가져온 순서대로 템플릿 슬롯에 들어갑니다.");
  const hasClips = s.project.tracks.some((t) => t.clips.length > 0);
  if (hasClips && !confirm(`'${def.name}' 템플릿으로 타임라인을 새로 구성할까요? (실행 취소로 되돌릴 수 있습니다)`)) return;
  await withBusy("템플릿 적용", async () => {
    // 1) 필요한 에셋 준비
    const stickerMap = new Map<string, MediaItem>();
    for (const st of def.stickers ?? []) {
      const sd = STICKERS.find((x) => x.id === st.id);
      if (sd && !stickerMap.has(sd.id)) {
        const m = await stickerMedia(sd);
        if (m) stickerMap.set(sd.id, m);
      }
    }
    const soundIds = new Set([...(def.sounds ?? []).map((x) => x.id), ...(def.whooshOnCuts ? ["whoosh"] : []), ...(def.bgm ? [def.bgm] : [])]);
    const soundMap = new Map<string, MediaItem>();
    for (const id of soundIds) {
      const m = await soundMedia(id);
      if (m) soundMap.set(id, m);
    }
    // 2) 타임라인 구성 (한 번의 커밋 → 실행 취소 한 번으로 되돌림)
    const [W, H] = ASPECTS[def.aspect];
    ed().commit((p0) => {
      let p: Project = { ...p0, width: W, height: H, tracks: [newTrack("video", true)] };
      const mainId = p.tracks[0].id;
      const td = def.transitionDuration ?? 0.6;
      let t = 0;
      const cuts: number[] = [];
      for (let i = 0; i < def.slots; i++) {
        const m = sources[i % sources.length];
        const d = m.kind === "video" ? Math.min(def.slotDuration, Math.max(0.5, m.duration)) : def.slotDuration;
        const tr = def.transitions?.length && i < def.slots - 1 ? { id: def.transitions[i % def.transitions.length], duration: td } : undefined;
        const c: Clip = { ...clipFromMedia(m, t), duration: d, transition: tr, filter: def.filter, canvas: def.canvas, keyframes: cameraKeys(def.camera, i, d) };
        p = placeClip(p, c, mainId);
        t += d;
        if (i < def.slots - 1) cuts.push(t);
      }
      const total = t;
      const at = (start: number) => (start < 0 ? Math.max(0, total + start) : start);
      for (const tx of def.texts ?? []) {
        const c = textClip(at(tx.start), tx.content);
        c.text = { ...c.text!, ...tx.style };
        c.duration = Math.min(tx.duration, total - c.start);
        c.transform = { ...c.transform, x: tx.x ?? 0, y: tx.y ?? 0.3 };
        c.animIn = tx.animIn;
        c.animOut = tx.animOut;
        c.animLoop = tx.animLoop;
        p = placeClip(p, c);
      }
      for (const fx of def.effects ?? []) {
        const ed2 = findEffect(fx.id);
        if (!ed2) continue;
        const c = effectClip(at(fx.start), "effect", { id: fx.id, params: { ...defaultParams(ed2), ...fx.params } }, Math.min(fx.duration, total - at(fx.start)));
        p = placeClip(p, c);
      }
      for (const st of def.stickers ?? []) {
        const m = stickerMap.get(st.id);
        if (m) p = placeClip(p, stickerClip(m, at(st.start), Math.min(st.duration, total - at(st.start)), st.x, st.y, st.scale, st.loop));
      }
      const sfx: { id: string; start: number }[] = [...(def.sounds ?? []), ...(def.whooshOnCuts ? cuts.map((c) => ({ id: "whoosh", start: Math.max(0, c - 0.35) })) : [])];
      for (const sd of sfx) {
        const m = soundMap.get(sd.id);
        if (m) p = placeClip(p, { ...clipFromMedia(m, at(sd.start)), duration: Math.min(m.duration, total - at(sd.start)) });
      }
      const bgm = def.bgm && soundMap.get(def.bgm);
      if (bgm && bgm.duration > 0) {
        // 배경음악을 이어 붙여 전체 길이를 채우고 끝에서 페이드 아웃
        const track = newTrack("audio");
        let bt = 0;
        while (bt < total - 0.05) {
          const d = Math.min(bgm.duration, total - bt);
          track.clips.push({ ...clipFromMedia(bgm, bt), duration: d, volume: 0.6, fadeOut: bt + d >= total - 0.05 ? Math.min(1.5, d / 2) : 0 });
          bt += d;
        }
        p = { ...p, tracks: [...p.tracks, track] };
      }
      return normalize(p, true);
    });
    ed().select([]);
    ed().setPlayhead(0);
    ed().notify(`'${def.name}' 템플릿을 적용했습니다`);
  });
}
