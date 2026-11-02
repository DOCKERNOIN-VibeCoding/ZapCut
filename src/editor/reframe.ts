// 포맷 변환 실행: 얼굴 기준이면 클립마다 몇 장면에서 얼굴을 찾아 기준점을 정하고, 텍스트·타이틀은 실제 글꼴로 폭을 재서
// 코어 함수(src/core/reframe.ts)에 넘긴다. 변환 창과 외부 제어(MCP) reframe 도구가 함께 쓴다.
import { cropAspect, reframeProject, reframeTargets, sourceAspect, type Anchor, type ReframeOptions, type ReframeResult } from "../core/reframe";
import { measureTextBox } from "../core/textRender";
import { titleExtent } from "../core/titles";
import type { Clip, MediaItem } from "../core/types";
import { detectFaces } from "./faces";
import { useEditor } from "./store";

export type ReframeAnchor = "center" | "face";
export interface ReframeSummary extends Omit<ReframeResult, "project"> {
  width: number;
  height: number;
  clips: number; // 변환 대상 클립 수
  faces: number; // 얼굴을 찾아 기준으로 삼은 클립 수
  noFace: string[]; // 얼굴을 찾지 못해 가운데로 둔 클립 이름
}

const SAMPLES = 5; // 영상 클립당 얼굴을 찾아 볼 장면 수

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** 클립 구간의 몇 장면에서 가장 큰 얼굴의 중심(원본 비율)을 모아 중간값을 낸다. 한 장면에서도 못 찾으면 undefined */
async function faceAnchor(clip: Clip, m: MediaItem): Promise<Anchor | undefined> {
  const times = clip.kind === "video" ? Array.from({ length: SAMPLES }, (_, i) => clip.in + ((i + 0.5) / SAMPLES) * clip.duration * clip.speed) : [0];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of times) {
    const faces = await detectFaces(m, t).catch(() => []);
    const f = faces.sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (!f) continue;
    xs.push((f.x + f.w / 2) / m.width);
    ys.push((f.y + f.h / 2) / m.height);
  }
  return xs.length ? { x: median(xs), y: median(ys) } : undefined;
}

/** 텍스트·타이틀의 자연 폭(px). 타이틀 좌표는 1080p 기준 */
const measure = (c: Clip, Href: number) => (c.title ? (titleExtent(c.title).w * Href) / 1080 : c.text ? measureTextBox(c.text, Href).w : undefined);

export async function reframe(o: ReframeOptions & { anchor: ReframeAnchor }): Promise<ReframeSummary> {
  const ed = useEditor.getState();
  const targets = reframeTargets(ed.project);
  const target = o.width / o.height;
  const anchors: Record<string, Anchor> = {};
  const noFace: string[] = [];
  if (o.anchor === "face") {
    // 실제로 잘릴 클립에서만 찾는다
    const todo = targets.filter(({ clip, media }) => Math.abs(cropAspect(sourceAspect(clip, media), target, o.fit) - sourceAspect(clip, media)) > 1e-3);
    try {
      for (let i = 0; i < todo.length; i++) {
        useEditor.getState().setBusy(`얼굴 찾기 ${i + 1}/${todo.length}`);
        const { clip, media } = todo[i];
        const a = await faceAnchor(clip, media);
        if (a) anchors[clip.id] = a;
        else noFace.push(media.name);
      }
    } finally {
      useEditor.getState().setBusy(undefined);
    }
  }
  let r!: ReframeResult;
  useEditor.getState().commit((p) => {
    r = reframeProject(p, o, { anchors, measure });
    return r.project;
  });
  return { width: o.width, height: o.height, clips: targets.length, cropped: r.cropped, boxed: r.boxed, shrunk: r.shrunk, faces: Object.keys(anchors).length, noFace };
}

/** 결과 알림 문구 */
export function reframeMessage(r: ReframeSummary) {
  const parts = [`${r.width} × ${r.height}으로 바꿨습니다`];
  if (r.cropped) parts.push(`클립 ${r.cropped}개를 잘랐습니다`);
  if (r.faces) parts.push(`얼굴 기준 ${r.faces}개`);
  if (r.noFace.length) parts.push(`얼굴을 못 찾아 가운데로 둠: ${r.noFace.join(", ")}`);
  if (r.shrunk) parts.push(`텍스트 ${r.shrunk}개를 줄였습니다`);
  return parts.join(" · ");
}
