// 영역 따라가기: 효과·조정 클립의 영역을 아래 영상 속 대상에 맞춰 움직이는 키프레임으로 만든다
import { hasMask, maskAt } from "../core/mask";
import { placement, toCanvas, toSource } from "../core/placement";
import { clipEnd, findClip } from "../core/timeline";
import { simplify, smoothBoxes, type Box } from "../core/track";
import type { Clip, KfProp, Keyframe, MediaItem, Project } from "../core/types";
import { frameAt } from "../preview/frame";
import { useEditor } from "./store";

const RATE = 15; // 타임라인 1초에 분석할 프레임 수
const REGION_PROPS = ["maskX", "maskY", "maskW", "maskH"] as const;
// 키프레임 단순화 허용 오차 (위치는 화면 비율, 크기는 짧은 변 비율)
const TOL: Record<(typeof REGION_PROPS)[number], number> = { maskX: 0.002, maskY: 0.002, maskW: 0.004, maskH: 0.004 };

/** 시각 t에 영역 중심 아래 보이는 가장 위 영상 클립 (효과 트랙보다 아래) */
export function targetVideo(p: Project, region: Clip, t: number) {
  const W = p.width;
  const H = p.height;
  const m = maskAt(region, t - region.start);
  const X = W / 2 + m.x * W;
  const Y = H / 2 + m.y * H;
  const layers = frameAt(p, t).layers.filter((l) => l.clip.kind === "video" && l.media);
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const pl = placement(l.clip, l.media!, l.T, W, H);
    const s = toSource(pl, X, Y);
    if (s.x >= pl.ox && s.y >= pl.oy && s.x <= pl.ox + pl.sw && s.y <= pl.oy + pl.sh) return { clip: l.clip, media: l.media! };
  }
  return undefined;
}

/**
 * 추적 결과(원본 대비 0..1 상자, RATE 간격) → 영역 키프레임.
 * t0 = 시작 시각(타임라인), 키 시각은 영역 클립 시작 기준. [t0, 끝] 밖의 기존 키는 남긴다.
 */
export function regionKeys(p: Project, region: Clip, video: Clip, media: MediaItem, t0: number, boxes: Box[]): Partial<Record<KfProp, Keyframe[]>> {
  const W = p.width;
  const H = p.height;
  const M = Math.min(W, H);
  const pts: Record<(typeof REGION_PROPS)[number], { t: number; v: number; ease: "linear" }[]> = { maskX: [], maskY: [], maskW: [], maskH: [] };
  smoothBoxes(boxes).forEach((b, i) => {
    const t = t0 + i / RATE;
    const pl = placement(video, media, t - video.start, W, H);
    const a = toCanvas(pl, b.x * media.width, b.y * media.height);
    const z = toCanvas(pl, (b.x + b.w) * media.width, (b.y + b.h) * media.height);
    const T = t - region.start;
    pts.maskX.push({ t: T, v: (a.X + z.X) / 2 / W - 0.5, ease: "linear" });
    pts.maskY.push({ t: T, v: (a.Y + z.Y) / 2 / H - 0.5, ease: "linear" });
    pts.maskW.push({ t: T, v: Math.abs(z.X - a.X) / M, ease: "linear" });
    pts.maskH.push({ t: T, v: Math.abs(z.Y - a.Y) / M, ease: "linear" });
  });
  const T0 = t0 - region.start;
  const T1 = T0 + (boxes.length - 1) / RATE;
  const out: Partial<Record<KfProp, Keyframe[]>> = {};
  for (const prop of REGION_PROPS) {
    const keep = (region.keyframes?.[prop] ?? []).filter((k) => k.t < T0 - 1e-3 || k.t > T1 + 1e-3);
    out[prop] = [...keep, ...simplify(pts[prop], TOL[prop])].sort((a, b) => a.t - b.t);
  }
  return out;
}

/** 재생헤드에서부터 영역 클립 끝(또는 대상 영상 끝)까지 따라간다 */
export async function trackRegion(regionId: string) {
  const s = useEditor.getState();
  const p = s.project;
  const found = findClip(p, regionId);
  const region = found?.clip;
  if (!region || !hasMask(region.mask)) return s.notify("영역이 있는 가리기(효과) 클립을 고르세요", "error");
  const t0 = s.playhead;
  if (t0 < region.start || t0 >= clipEnd(region) - 0.1) return s.notify("재생헤드를 가리기 클립 안으로 옮기고, 대상 위에 영역을 맞춘 뒤 누르세요", "error");
  const target = targetVideo(p, region, t0);
  if (!target) return s.notify("영역 아래에 따라갈 영상이 없습니다 (사진은 움직이지 않아 필요 없습니다)", "error");
  const { clip: video, media } = target;
  const t1 = Math.min(clipEnd(region), clipEnd(video));
  // 영역(화면) → 원본 상자
  const W = p.width;
  const H = p.height;
  const M = Math.min(W, H);
  const m = maskAt(region, t0 - region.start);
  const pl = placement(video, media, t0 - video.start, W, H);
  const cx = W / 2 + m.x * W;
  const cy = H / 2 + m.y * H;
  const a = toSource(pl, cx - (m.w * M) / 2, cy - (m.h * M) / 2);
  const z = toSource(pl, cx + (m.w * M) / 2, cy + (m.h * M) / 2);
  const box = { x: Math.min(a.x, z.x) / media.width, y: Math.min(a.y, z.y) / media.height, w: Math.abs(z.x - a.x) / media.width, h: Math.abs(z.y - a.y) / media.height };
  const off = window.zapcut.onTrackProgress((v) => s.setBusy(`영역 따라가기 ${Math.round(v * 100)}%`));
  s.setBusy("영역 따라가기");
  try {
    const r = await window.zapcut.trackRegion({
      path: media.path,
      start: video.in + (t0 - video.start) * video.speed,
      duration: (t1 - t0) * video.speed,
      fps: RATE * video.speed,
      srcW: media.width,
      srcH: media.height,
      box,
    });
    const keys = regionKeys(useEditor.getState().project, region, video, media, t0, r.boxes);
    s.updateClip(regionId, (c) => ({ ...c, keyframes: { ...c.keyframes, ...keys } }));
    const end = t0 + (r.boxes.length - 1) / RATE;
    if (r.lostAt !== undefined) s.notify(`${end.toFixed(1)}초에서 대상을 놓쳤습니다. 그 자리에서 영역을 다시 맞추고 '따라가기'를 누르면 이어서 따라갑니다`, "error");
    else s.notify(`영역이 대상을 따라가도록 키프레임을 만들었습니다 (최대 ${Math.max(...Object.values(keys).map((k) => k?.length ?? 0))}개)`);
    if (pl.rotation % 360 !== 0) s.notify("회전된 영상은 따라가기가 정확하지 않을 수 있습니다", "error");
  } catch (e) {
    s.notify(`따라가기 실패: ${(e as Error).message}`, "error");
  } finally {
    off();
    s.setBusy(undefined);
  }
}
