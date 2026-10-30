// 자동 캡션: 소리가 있는 클립의 말소리를 받아 적어 자막 클립으로 만든다 (whisper.cpp, 이 PC에서 처리)
import { CAPTION_MODELS, captionClips, parseWhisperJson } from "../core/captions";
import { newTrack, placeClip } from "../core/timeline";
import type { Clip, Project } from "../core/types";
import { useEditor } from "./store";

export interface CaptionOptions {
  language: string;
  modelId: string;
}

/** 받아 적을 클립: 선택한 소리 있는 클립, 없으면 프로젝트의 소리 있는 영상·오디오 클립 전부 (시간순) */
export function captionTargets(p: Project, selection: string[]): Clip[] {
  const audible = (c: Clip) => !c.muted && (c.kind === "audio" || (c.kind === "video" && !!p.media.find((m) => m.id === c.mediaId)?.hasAudio));
  const all = p.tracks
    .filter((t) => !t.muted)
    .flatMap((t) => t.clips)
    .filter(audible)
    .sort((a, b) => a.start - b.start);
  const sel = all.filter((c) => selection.includes(c.id));
  return sel.length ? sel : all;
}

/** 모델 파일이 없으면 물어보고 내려받는다. 돌려주는 값 = 파일 이름 (취소·실패면 undefined) */
export async function ensureModel(modelId: string): Promise<string | undefined> {
  const def = CAPTION_MODELS.find((m) => m.id === modelId) ?? CAPTION_MODELS[0];
  const have = await window.zapcut.captionModels();
  if (have.includes(def.file)) return def.file;
  if (!confirm(`음성 인식 모델 "${def.name}"을 처음 한 번 내려받습니다 (${Math.round(def.size / 1048576)}MB). 계속할까요?`)) return undefined;
  const s = useEditor.getState();
  const off = window.zapcut.onCaptionProgress((p) => p.phase === "download" && useEditor.getState().setBusy(`모델 내려받는 중 ${Math.round(p.v * 100)}%`));
  s.setBusy("모델 내려받는 중");
  try {
    await window.zapcut.downloadCaptionModel(def.url, def.file, def.size);
    return def.file;
  } catch (e) {
    s.notify(/취소/.test((e as Error).message) ? "모델 내려받기를 취소했습니다" : `모델 내려받기 실패: ${(e as Error).message}`, "error");
    return undefined;
  } finally {
    off();
    useEditor.getState().setBusy(undefined);
  }
}

/** 자막 전용 트랙(맨 위)에 넣는다. 없으면 만든다 */
export function addCaptions(p: Project, clips: Clip[]): Project {
  let track = p.tracks.find((t) => t.kind === "text" && t.clips.some((c) => c.caption));
  let next = p;
  if (!track) {
    track = newTrack("text");
    next = { ...p, tracks: [track, ...p.tracks] };
  }
  for (const c of clips) next = placeClip(next, c, track.id);
  return next;
}

export async function autoCaption(opts: CaptionOptions) {
  const s = useEditor.getState();
  const targets = captionTargets(s.project, s.selection);
  if (!targets.length) return s.notify("받아 적을 소리가 있는 영상이나 오디오 클립이 없습니다", "error");
  const model = await ensureModel(opts.modelId);
  if (!model) return;
  let idx = 0;
  let made = 0;
  const off = window.zapcut.onCaptionProgress((p) => p.phase === "run" && useEditor.getState().setBusy(`자동 캡션 ${idx}/${targets.length} · ${Math.round(p.v * 100)}%`));
  try {
    for (const c of targets) {
      idx++;
      const media = useEditor.getState().project.media.find((m) => m.id === c.mediaId);
      if (!media) continue;
      useEditor.getState().setBusy(`자동 캡션 ${idx}/${targets.length}`);
      const json = await window.zapcut.runCaption({ path: media.path, start: c.in, duration: c.duration * c.speed, language: opts.language, model });
      const clips = captionClips(c, parseWhisperJson(json));
      if (!clips.length) continue;
      useEditor.getState().commit((p) => addCaptions(p, clips));
      made += clips.length;
    }
    useEditor.getState().notify(made ? `자막 ${made}개를 만들었습니다. 자막 목록에서 바로 고칠 수 있습니다` : "말소리를 찾지 못했습니다");
  } catch (e) {
    useEditor.getState().notify(/취소/.test((e as Error).message) ? "자동 캡션을 취소했습니다" : `자동 캡션 실패: ${(e as Error).message}`, "error");
  } finally {
    off();
    useEditor.getState().setBusy(undefined);
  }
}
