// MCP 도구 목록: 이름·설명·입력 스키마. 브리지(electron/mcp.ts)가 Claude에 등록하고,
// 처리는 렌더러(src/editor/control.ts)의 같은 이름 처리기 또는 메인(electron/control.ts, main: true)이 한다.
import { z } from "zod";

export interface ToolDef {
  title: string;
  description: string;
  schema: Record<string, z.ZodType>;
  main?: boolean; // 메인 프로세스가 처리
  readOnly?: boolean; // 상태를 바꾸지 않음
}

const id = z.string().min(1);
const time = z.number().min(0).describe("초");

export const TOOLS: Record<string, ToolDef> = {
  get_state: {
    title: "상태 보기",
    description:
      "현재 프로젝트 요약: 캔버스 크기·fps·길이, 미디어 목록, 트랙과 클립(id·시작·길이·종류), 재생헤드·선택·진행 중 작업. 작업 전에 먼저 부른다. full=true면 클립의 모든 속성을 포함한다.",
    schema: { full: z.boolean().optional().describe("클립 전체 속성 포함") },
    readOnly: true,
  },
  get_clip: {
    title: "클립 보기",
    description: "클립 하나의 모든 속성(transform, text, crop, filter, keyframes 등)과 트랙 id.",
    schema: { id },
    readOnly: true,
  },
  new_project: {
    title: "새 프로젝트",
    description: "새 프로젝트를 만든다(지금 열린 프로젝트의 저장하지 않은 변경은 사라진다). ratio+short로 정하거나 width/height를 직접 준다.",
    schema: {
      name: z.string().optional(),
      ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).optional().describe("화면 비율 (기본 16:9)"),
      short: z.number().int().optional().describe("짧은 변 해상도: 480·720·1080·1440·2160 (기본 1080)"),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      fps: z.number().optional().describe("기본 30"),
    },
  },
  set_project: {
    title: "프로젝트 속성",
    description: "이름·캔버스 크기·fps·배경색을 바꾼다. 클립 위치는 캔버스 비율 기준이므로 캔버스 크기를 바꿔도 상대 배치는 유지된다.",
    schema: {
      name: z.string().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      fps: z.number().optional(),
      background: z.string().optional().describe("#rrggbb"),
    },
  },
  open_project: {
    title: "프로젝트 열기",
    description: ".zapcut 파일을 연다. 찾을 수 없는 미디어 경로 목록(missing)을 함께 돌려준다.",
    schema: { path: z.string() },
  },
  save_project: {
    title: "프로젝트 저장",
    description: ".zapcut 파일로 저장한다. path를 생략하면 현재 파일에 저장(처음 저장이면 path 필수).",
    schema: { path: z.string().optional() },
  },
  import_media: {
    title: "미디어 가져오기",
    description: "영상·사진·소리 파일을 미디어 라이브러리에 넣고 media id를 돌려준다. 로컬 경로 또는 http(s) URL(내려받아 저장). 타임라인에 올리려면 add_to_timeline.",
    schema: { paths: z.array(z.string()).min(1), names: z.array(z.string()).optional().describe("표시 이름(paths와 같은 순서)") },
  },
  add_to_timeline: {
    title: "타임라인에 올리기",
    description: "미디어를 클립으로 타임라인에 놓고 clip id를 돌려준다. start 생략 시 재생헤드 위치, append=true면 메인 트랙 끝에 이어 붙인다. 영상·사진은 메인 트랙, 소리는 오디오 트랙에 놓인다.",
    schema: { media_id: id, start: time.optional(), append: z.boolean().optional(), track_id: z.string().optional() },
  },
  add_text: {
    title: "텍스트 추가",
    description:
      "텍스트 클립을 추가한다. style은 TextStyle 일부: fontFamily, fontSize(1080p 기준 px, 기본 96), color, color2(그라데이션), bold, italic, align, strokeColor, strokeWidth, background, bgRadius, shadowColor, shadowBlur, shadowX, shadowY, glow, letterSpacing, lineHeight, runs(글자 범위별 색·크기: [{start,end,color?,fontSize?}], content의 UTF-16 인덱스). 애니메이션 id는 list_library(animations).",
    schema: {
      content: z.string(),
      start: time.optional(),
      duration: z.number().positive().optional().describe("기본 3초"),
      style: z.record(z.string(), z.unknown()).optional(),
      x: z.number().optional().describe("가로 위치: 캔버스 너비 비율(0 가운데, ±0.5 끝)"),
      y: z.number().optional().describe("세로 위치: 캔버스 높이 비율(음수 위)"),
      scale: z.number().positive().optional(),
      anim_in: z.string().optional(),
      anim_out: z.string().optional(),
      anim_loop: z.string().optional(),
    },
  },
  add_title: {
    title: "타이틀 템플릿 추가",
    description: "여러 레이어가 시간차로 등장하는 타이틀을 추가한다. template_id와 텍스트 레이어 목록은 list_library(titles). texts는 텍스트 레이어 순서대로 바꿀 내용.",
    schema: {
      template_id: id,
      start: time.optional(),
      duration: z.number().positive().optional(),
      texts: z.array(z.string()).optional(),
      y: z.number().optional().describe("세로 위치(기본: 템플릿 값)"),
    },
  },
  list_library: {
    title: "라이브러리 목록",
    description:
      "id 목록: titles(타이틀 템플릿), text_templates, transitions(전환), filters, effects, animations(등장·퇴장·반복), stickers, sounds(효과음·배경음악), templates(영상 템플릿), fonts(번들 글꼴).",
    schema: { kind: z.enum(["titles", "text_templates", "transitions", "filters", "effects", "animations", "stickers", "sounds", "templates", "fonts"]) },
    readOnly: true,
  },
  update_clip: {
    title: "클립 수정",
    description:
      "클립 속성을 바꾼다. patch 키: start(이동), track_id(다른 트랙으로), duration, in(원본 시작), speed(0.1~10), volume(0~2), muted, fadeIn, fadeOut, transform{x,y,scale,rotation,opacity}, adjust{brightness,contrast,saturation,exposure,temperature,tint,highlights,shadows,vibrance,fade,hue,sharpen,vignette: -1~1}, text{TextStyle}, crop{l,t,r,b: 0~0.9}, canvas{type: none|color|blur, color, blur}, filter{id,intensity}, transition{id,duration}, animIn/animOut/animLoop{id,duration}, flipH, flipV, blend, chroma, mask, keyframes. 중첩 객체는 기존 값과 합쳐진다.",
    schema: { id, patch: z.record(z.string(), z.unknown()) },
  },
  delete_clips: {
    title: "클립 삭제",
    description: "클립들을 지운다. 메인 트랙은 자석이 켜져 있으면 뒤 클립이 당겨진다.",
    schema: { ids: z.array(id).min(1) },
  },
  split_clip: {
    title: "클립 분할",
    description: "클립을 time(타임라인 시간)에서 둘로 나누고 오른쪽 조각의 id를 돌려준다.",
    schema: { id, time },
  },
  set_playhead: { title: "재생헤드 이동", description: "재생헤드(미리보기 시점)를 옮긴다.", schema: { time } },
  select: { title: "선택", description: "클립을 선택한다(빈 배열이면 선택 해제). 선택 상자가 미리보기에 표시된다.", schema: { ids: z.array(z.string()) } },
  undo: { title: "실행 취소", description: "마지막 편집을 되돌린다.", schema: {} },
  redo: { title: "다시 실행", description: "되돌린 편집을 다시 적용한다.", schema: {} },
  screenshot: {
    title: "화면 캡처",
    description: "미리보기(또는 창 전체)를 PNG 이미지로 돌려준다. time을 주면 그 시점으로 재생헤드를 옮긴 뒤 찍는다. 자막 위치·크롭·색을 눈으로 확인할 때 쓴다.",
    schema: { time: time.optional(), region: z.enum(["preview", "window"]).optional().describe("기본 preview") },
    main: true,
    readOnly: true,
  },
  export: {
    title: "내보내기",
    description:
      "MP4/MOV로 렌더링한다. resolution은 짧은 변 등급(480·720·1080·1440·2160, 기본: 프로젝트에 가장 가까운 등급). encoder 생략 시 GPU 인코더가 있으면 자동 선택하고 실패하면 CPU로 재시도. 기본은 끝날 때까지 기다리며(수 분 가능), wait=false면 바로 돌아오고 export_status로 확인한다.",
    schema: {
      path: z.string().describe("출력 파일 경로(.mp4 또는 .mov)"),
      resolution: z.number().int().optional(),
      fps: z.number().optional(),
      quality: z.enum(["high", "medium", "low"]).optional(),
      encoder: z.enum(["libx264", "h264_nvenc", "h264_qsv", "h264_amf"]).optional(),
      format: z.enum(["mp4", "mov"]).optional(),
      wait: z.boolean().optional().describe("기본 true"),
    },
  },
  export_status: { title: "내보내기 상태", description: "진행 중인 내보내기의 진행률(0~1)과 결과.", schema: {}, readOnly: true },
  cancel_export: { title: "내보내기 취소", description: "진행 중인 내보내기를 멈춘다.", schema: {} },
  app_info: { title: "앱 정보", description: "ZapCut 버전과 경로.", schema: {}, main: true, readOnly: true },
};
