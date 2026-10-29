// 짭컷 프로젝트 데이터 모델. 시간 단위는 모두 초(second).

export type MediaKind = "video" | "audio" | "image";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  path: string;
  name: string;
  duration: number; // 이미지는 0
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  codec?: string;
  proxy?: string; // 미리보기용 H.264 프록시 (원본을 브라우저가 재생할 수 없을 때)
  thumbnail?: string; // file path (jpg)
  filmstrip?: string; // file path (가로로 이어붙인 jpg)
  filmstripFrames?: number;
  waveform?: number[]; // 0..1 피크, 초당 WAVE_RATE개
  sticker?: boolean; // 스티커 라이브러리에서 만든 이미지
}

export const WAVE_RATE = 50;

export type TrackKind = "video" | "audio" | "text" | "effect";

export interface Transform {
  x: number; // 캔버스 중심 기준 가로 오프셋 (캔버스 너비 비율)
  y: number; // 세로 오프셋 (캔버스 높이 비율)
  scale: number; // 1 = 캔버스에 맞춤
  rotation: number; // 도(degree)
  opacity: number; // 0..1
}

/** 모든 값은 -1..1 (0 = 변화 없음). 3D LUT 하나로 합쳐 적용된다. */
export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  fade: number; // 0..1 (검정 띄우기)
  hue: number; // -1..1 → -180..180도
  sharpen: number; // 0..1 (LUT 아님, 별도 필터)
  vignette: number; // 0..1 (LUT 아님, 별도 필터)
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  fontSize: number; // 1080p 캔버스 기준 px
  color: string;
  color2?: string; // 있으면 위→아래 그라데이션
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  strokeColor: string;
  strokeWidth: number;
  background: string; // "" = 없음
  bgRadius?: number; // 배경 모서리 둥글기(px)
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  glow?: string; // 네온 효과 색 ("" = 없음)
  letterSpacing?: number; // px
  lineHeight?: number; // 배수 (기본 1.25)
}

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "hold";
export type KfProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
export interface Keyframe {
  t: number; // 클립 시작 기준 시간
  v: number;
  ease: Easing; // 이 키에서 다음 키로 갈 때의 곡선
}

export interface AnimRef {
  id: string;
  duration: number;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number; // 각 가장자리에서 잘라낼 비율 (0..0.9)
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number; // 0.01..1
  blend: number; // 0..1
}

export type MaskType = "none" | "linear" | "mirror" | "circle" | "rect";
export interface Mask {
  type: MaskType;
  x: number; // 레이어 중심 기준 오프셋 (레이어 크기 비율)
  y: number;
  w: number; // 레이어 크기 비율 (원/사각형)
  h: number;
  rotation: number;
  feather: number; // 0..1
  invert: boolean;
}

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "addition" | "difference" | "exclusion";

export interface CanvasBg {
  type: "none" | "color" | "blur";
  color: string;
  blur: number; // 0..1
}

export interface Transition {
  id: string;
  duration: number;
}

export interface EffectRef {
  id: string;
  params: Record<string, number>;
}

export interface Clip {
  id: string;
  kind: "video" | "image" | "audio" | "text" | "effect" | "adjust";
  mediaId?: string;
  start: number; // 타임라인 시작 위치
  duration: number; // 타임라인 상 길이
  in: number; // 원본 시작 위치
  speed: number;
  volume: number; // 0..2
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  adjust: Adjust;
  text?: TextStyle;
  // 2단계
  keyframes?: Partial<Record<KfProp, Keyframe[]>>;
  animIn?: AnimRef;
  animOut?: AnimRef;
  animLoop?: AnimRef;
  flipH?: boolean;
  flipV?: boolean;
  crop?: Crop;
  chroma?: ChromaKey;
  mask?: Mask;
  blend?: BlendMode;
  filter?: { id: string; intensity: number };
  lut?: { path: string; name: string; intensity: number };
  canvas?: CanvasBg; // 메인 트랙 클립의 빈 영역 배경
  transition?: Transition; // 메인 트랙에서 이 클립 → 다음 클립 전환
  effect?: EffectRef; // kind === "effect"
}

export interface Track {
  id: string;
  kind: TrackKind;
  main?: boolean;
  clips: Clip[];
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface Project {
  version: 1;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  // 첫 영상/이미지를 가져오면 그 비율로 캔버스를 맞춘다. 비율을 직접 고르면 지운다.
  fitFirstMedia?: true;
  media: MediaItem[];
  // 화면 표시 순서(위→아래). 영상 합성 순서는 아래쪽 트랙이 먼저(가장 뒤).
  tracks: Track[];
}

export const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
export const DEFAULT_ADJUST: Adjust = {
  brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vibrance: 0, fade: 0, hue: 0, sharpen: 0, vignette: 0,
};
export const DEFAULT_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 };
export const DEFAULT_CHROMA: ChromaKey = { enabled: false, color: "#00ff00", similarity: 0.3, blend: 0.1 };
export const DEFAULT_MASK: Mask = { type: "none", x: 0, y: 0, w: 0.6, h: 0.6, rotation: 0, feather: 0.1, invert: false };
export const DEFAULT_CANVAS: CanvasBg = { type: "none", color: "#000000", blur: 0.5 };
export const DEFAULT_TEXT: TextStyle = {
  content: "텍스트를 입력하세요",
  fontFamily: "Malgun Gothic",
  fontSize: 96,
  color: "#ffffff",
  bold: true,
  italic: false,
  align: "center",
  strokeColor: "#000000",
  strokeWidth: 6,
  background: "",
};

/** 이전 버전 프로젝트의 클립에 빠진 필드를 채운다 */
export function upgradeProject(p: Project): Project {
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => ({ ...c, adjust: { ...DEFAULT_ADJUST, ...c.adjust } })),
    })),
  };
}
