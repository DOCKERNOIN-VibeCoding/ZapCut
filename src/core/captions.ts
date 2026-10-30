// 자동 캡션: FFmpeg whisper 필터(whisper.cpp) 결과 → 자막 클립. 모델은 처음 쓸 때 내려받아 userData/models에 둔다.
import { textClip } from "./timeline";
import { DEFAULT_TEXT, type Clip, type TextStyle } from "./types";

export interface CaptionModel {
  id: string;
  name: string;
  file: string;
  url: string;
  size: number;
}
const HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
export const CAPTION_MODELS: CaptionModel[] = [
  { id: "small", name: "작은 모델 (빠름, 190MB)", file: "ggml-small-q5_1.bin", url: `${HF}ggml-small-q5_1.bin`, size: 190085487 },
  { id: "large", name: "큰 모델 (정확, 574MB)", file: "ggml-large-v3-turbo-q5_0.bin", url: `${HF}ggml-large-v3-turbo-q5_0.bin`, size: 574041195 },
];
export const CAPTION_LANGS = [
  { id: "ko", name: "한국어" },
  { id: "en", name: "영어" },
  { id: "ja", name: "일본어" },
  { id: "zh", name: "중국어" },
  { id: "auto", name: "자동 감지" },
];

/** 자막 클립 기본 모양 (텍스트 템플릿 '기본 자막'과 같음) */
export const CAPTION_STYLE: Partial<TextStyle> = { fontSize: 60, bold: false, strokeWidth: 4 };
export const CAPTION_Y = 0.4;

export interface Segment {
  start: number; // 초, 분석한 구간 시작 기준
  end: number;
  text: string;
}

/** whisper 필터 json 출력: 줄마다 {start, end, text} (밀리초). 빈 줄·깨진 줄·"[음악]" 같은 표시만 있는 줄은 버린다 */
export function parseWhisperJson(s: string): Segment[] {
  const out: Segment[] = [];
  for (const line of s.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { start?: number; end?: number; text?: string };
      const text = String(o.text ?? "").trim();
      if (!text || /^[[(（【].*[\])）】]$/.test(text) || !(Number(o.end) > Number(o.start))) continue;
      out.push({ start: Number(o.start) / 1000, end: Number(o.end) / 1000, text });
    } catch {
      // 다른 로그 줄
    }
  }
  return out;
}

const MIN_CAPTION = 0.3;

/**
 * 분석 결과 → 자막 클립. source = 소리가 난 클립 (분석 구간은 source.in부터 source 길이만큼).
 * 타임라인 시각 = source.start + 결과 시각 / 배속. 겹치는 문장은 다음 문장이 시작할 때 끝낸다.
 */
export function captionClips(source: Clip, segs: Segment[]): Clip[] {
  const end = source.start + source.duration;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: Clip[] = [];
  sorted.forEach((seg, i) => {
    const start = source.start + seg.start / source.speed;
    let stop = Math.min(end, source.start + seg.end / source.speed);
    const next = sorted[i + 1];
    if (next) stop = Math.min(stop, source.start + next.start / source.speed);
    if (start >= end - 0.05) return;
    const c = textClip(start, seg.text);
    c.duration = Math.max(MIN_CAPTION, stop - start);
    c.text = { ...DEFAULT_TEXT, ...CAPTION_STYLE, content: seg.text };
    c.transform = { ...c.transform, y: CAPTION_Y };
    c.caption = true;
    out.push(c);
  });
  return out;
}

const pad = (v: number, n = 2) => String(v).padStart(n, "0");
export function srtTime(t: number) {
  const ms = Math.round(t * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** 자막 클립 → SRT 문서 */
export function toSrt(clips: Clip[]): string {
  return [...clips]
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text?.content ?? ""}\n`)
    .join("\n");
}
