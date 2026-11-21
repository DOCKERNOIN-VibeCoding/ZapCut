import {
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioLines,
  Eye,
  EyeOff,
  ListChecks,
  Lock,
  Magnet,
  Redo2,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { findEffect } from "../core/effects";
import { adjacentPairs, DEFAULT_TRANSITION_DURATION, findTransition } from "../core/transitions";
import { clipEnd, clipFromMedia, findClip, mapClip, moveClip, resolveOverlap, uid, placeClip, projectDuration, snap, snapPoints, trimClip } from "../core/timeline";
import type { Clip, MediaItem, Track } from "../core/types";
import { WAVE_RATE } from "../core/types";
import { mediaUrl, useEditor } from "../editor/store";
import { ClipMenu } from "./ClipMenu";
import { shortTime } from "./format";

const HEADER_W = 96;
const RULER_H = 28;
const SNAP_PX = 8;
export const MEDIA_DND = "application/x-zapcut-media";
export const TRANSITION_DND = "application/x-zapcut-transition";

/** 컷(앞 클립)에 전환 적용 */
function dropTransition(e: React.DragEvent, clip: Clip) {
  const id = e.dataTransfer.getData(TRANSITION_DND);
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  const s = useEditor.getState();
  s.setTransition(clip.id, { id, duration: clip.transition?.duration ?? DEFAULT_TRANSITION_DURATION });
  s.select([clip.id]);
  s.notify(`전환 적용: ${findTransition(id)?.name}`);
}

const trackHeight = (t: Track) => (t.main ? 76 : t.kind === "text" || t.kind === "effect" ? 32 : t.kind === "audio" ? 50 : 58);

function Waveform({ media, clip, height }: { media: MediaItem; clip: Clip; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useEditor((s) => s.zoom);
  const width = Math.max(1, Math.round(clip.duration * zoom));
  useEffect(() => {
    const c = ref.current;
    if (!c || !media.waveform) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const peaks = media.waveform;
    for (let x = 0; x < width; x++) {
      const srcT = clip.in + (x / zoom) * clip.speed;
      const v = peaks[Math.floor(srcT * WAVE_RATE)] ?? 0;
      const h = Math.max(1, v * height * Math.min(1, clip.volume));
      ctx.fillRect(x, (height - h) / 2, 1, h);
    }
  }, [media.waveform, clip.in, clip.speed, clip.volume, clip.duration, zoom, width, height]);
  if (!media.waveform) return null;
  return <canvas ref={ref} className="wave" width={width} height={height} />;
}

function ClipView({ clip, track, media, onPointerDown, onContextMenu }: { clip: Clip; track: Track; media?: MediaItem; onPointerDown: (e: React.PointerEvent, mode: "move" | "left" | "right") => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const zoom = useEditor((s) => s.zoom);
  const selected = useEditor((s) => s.selection.includes(clip.id));
  const h = trackHeight(track) - 6;
  const style: React.CSSProperties = { left: clip.start * zoom, width: Math.max(2, clip.duration * zoom), height: h };
  let bg: React.CSSProperties = {};
  if (media?.filmstrip && media.kind === "video" && clip.kind === "video") {
    const stripW = (media.duration / clip.speed) * zoom;
    bg = { backgroundImage: `url("${mediaUrl(media.filmstrip)}")`, backgroundSize: `${stripW}px 100%`, backgroundPosition: `${-(clip.in / clip.speed) * zoom}px 0`, backgroundRepeat: "no-repeat" };
  } else if (media?.thumbnail && media.kind === "image") {
    bg = { backgroundImage: `url("${mediaUrl(media.thumbnail)}")`, backgroundSize: `auto 100%`, backgroundRepeat: "repeat-x" };
  }
  const label = clip.kind === "text" ? clip.text?.content : clip.kind === "effect" ? `✦ ${findEffect(clip.effect?.id)?.name ?? "효과"}` : clip.kind === "adjust" ? "조정 레이어" : media?.name;
  const kfTimes = selected ? [...new Set(Object.values(clip.keyframes ?? {}).flatMap((ks) => (ks ?? []).map((k) => +k.t.toFixed(3))))] : [];
  return (
    <div className={`clip ${clip.kind} ${selected ? "selected" : ""}`} data-clip-id={clip.id} style={style} onPointerDown={(e) => onPointerDown(e, "move")} onContextMenu={onContextMenu}>
      <div className="clip-body" style={bg}>
        <span className="clip-label">
          {clip.speed !== 1 && <b>{clip.speed.toFixed(2)}x </b>}
          {label}
        </span>
        {media && (clip.kind === "audio" || (clip.kind === "video" && media.hasAudio)) && (
          <Waveform media={media} clip={clip} height={clip.kind === "audio" ? h - 16 : 16} />
        )}
      </div>
      {clip.animIn && <span className="anim-ramp in" style={{ width: Math.min(clip.animIn.duration, clip.duration) * zoom }} />}
      {clip.animOut && <span className="anim-ramp out" style={{ width: Math.min(clip.animOut.duration, clip.duration) * zoom }} />}
      {clip.animLoop && <span className="anim-loop" title="반복 애니메이션">∞</span>}
      {(clip.filter || clip.lut) && <span className="clip-badge" title="필터">F</span>}
      {kfTimes.map((t) => (
        <span key={t} className="kf-dot" style={{ left: t * zoom }} />
      ))}
      <span className="trim left" onPointerDown={(e) => onPointerDown(e, "left")} />
      <span className="trim right" onPointerDown={(e) => onPointerDown(e, "right")} />
    </div>
  );
}

function Ruler({ width, zoom }: { width: number; zoom: number }) {
  // 화면 간격이 80px 이상이 되는 눈금 단위를 고른다
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * zoom >= 80) ?? 600;
  const ticks = [];
  for (let t = 0; t * zoom < width; t += step) ticks.push(t);
  return (
    <div className="ruler" style={{ width }}>
      {ticks.map((t) => (
        <span key={t} className="tick" style={{ left: t * zoom }}>
          {shortTime(t)}
        </span>
      ))}
    </div>
  );
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const playhead = useEditor((s) => s.playhead);
  const silence = useEditor((s) => s.silencePreview);
  const playing = useEditor((s) => s.playing);
  const magnet = useEditor((s) => s.magnet);
  const snapping = useEditor((s) => s.snapping);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const snapLine = useRef<HTMLDivElement>(null);
  const marquee = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const total = projectDuration(project);
  const width = Math.max((total + 30) * zoom, (scrollRef.current?.clientWidth ?? 1200) - HEADER_W);
  const ed = useEditor.getState;

  // 재생 중에는 재생헤드를 따라 넘기고, 멈춰 있을 때도 화면 밖으로 나가면(프로젝트 열기, Home/End, 편집점 이동 등) 보이는 곳까지 스크롤
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = playhead * zoom;
    const view = el.clientWidth - HEADER_W;
    if (playing) {
      if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
    } else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
    else if (x > el.scrollLeft + view) el.scrollLeft = x - view + 40;
  }, [playhead, playing, zoom]);

  // Ctrl+휠: 재생헤드 기준 확대/축소
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const s = ed();
      s.setZoom(s.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ed]);

  const timeAt = (clientX: number) => {
    const rect = contentRef.current!.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left) / ed().zoom);
  };

  /** 포인터 Y → 트랙 id (위/아래 바깥이면 "new") */
  /** @param layout 겨냥에 쓸 트랙 배치. 드래그 중에는 시작 시점 배치를 넘겨 줄이 밀려도 겨냥이 흔들리지 않게 한다 */
  const trackAt = (clientY: number, layout: Track[] = ed().project.tracks): string | "new" => {
    const rect = contentRef.current!.getBoundingClientRect();
    let y = clientY - rect.top - RULER_H;
    if (y < 0) return "new";
    for (const t of layout) {
      const h = trackHeight(t);
      if (y < h) return t.id;
      y -= h;
    }
    return "new";
  };

  const showSnap = (t?: number) => {
    const el = snapLine.current;
    if (!el) return;
    el.style.display = t === undefined ? "none" : "block";
    if (t !== undefined) el.style.left = `${t * ed().zoom}px`;
  };

  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // 이미 끝난 포인터면 붙잡을 수 없다 (무시)
    }
  };

  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = ed();
    s.setPlayhead(timeAt(e.clientX));
    let px = e.clientX;
    const scroll = autoScroll(() => ed().setPlayhead(timeAt(px)), false);
    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      scroll.follow(ev);
      ed().setPlayhead(timeAt(px));
    };
    const up = () => {
      scroll.stop();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // 창 밖에서 놓아도 끝을 받도록 포인터를 붙잡는다 (안 그러면 끌기·자동 스크롤이 멈추지 않는다)
    capture(e);
  };

  /**
   * 끄는 동안 포인터가 보이는 트랙 영역 가장자리(40px 안쪽)나 그 바깥에 있으면 그쪽으로 스크롤하고 onScroll을 부른다. 멀수록 빠르게.
   * 포인터를 멈춰 둬도 계속 스크롤되도록 프레임마다 확인한다. @param vertical 위아래로도 스크롤할지 (길이 조절은 좌우만)
   */
  const autoScroll = (onScroll: () => void, vertical: boolean) => {
    const scroller = scrollRef.current!;
    const EDGE = 40;
    const speed = (d: number) => (d < EDGE ? Math.min(30, Math.ceil((EDGE - d) / 2)) : 0);
    let px = 0;
    let py = 0;
    let raf = 0;
    const tick = () => {
      const v = scroller.getBoundingClientRect();
      const { scrollLeft, scrollTop } = scroller;
      scroller.scrollLeft += speed(v.right - px) - speed(px - (v.left + HEADER_W));
      if (vertical) scroller.scrollTop += speed(v.bottom - py) - speed(py - (v.top + RULER_H));
      if (scroller.scrollLeft !== scrollLeft || scroller.scrollTop !== scrollTop) onScroll();
      raf = requestAnimationFrame(tick);
    };
    return {
      follow: (ev: PointerEvent) => {
        px = ev.clientX;
        py = ev.clientY;
        if (!raf) raf = requestAnimationFrame(tick);
      },
      stop: () => cancelAnimationFrame(raf),
    };
  };

  /** 트랙 빈 곳: 클릭하면 선택 해제, 끌면 사각형 안에 걸친 클립을 고른다 (Ctrl/Shift면 기존 선택에 더함) */
  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const base = e.ctrlKey || e.shiftKey ? ed().selection : [];
    if (!base.length) ed().select([]);
    const content = contentRef.current!;
    const box = marquee.current!;
    // 시작점은 내용 기준 좌표로 기억한다 (자동 스크롤로 내용이 움직여도 제자리에 있도록)
    const r0 = content.getBoundingClientRect();
    const sx = e.clientX - r0.left;
    const sy = e.clientY - r0.top;
    let px = e.clientX;
    let py = e.clientY;
    const update = () => {
      const r = content.getBoundingClientRect();
      const x = px - r.left, y = py - r.top;
      const left = Math.min(sx, x), right = Math.max(sx, x);
      const top = Math.min(sy, y), bottom = Math.max(sy, y);
      Object.assign(box.style, { display: "block", left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      const hit = [...content.querySelectorAll<HTMLElement>(".clip[data-clip-id]")]
        .filter((el) => {
          const c = el.getBoundingClientRect();
          return c.right - r.left > left && c.left - r.left < right && c.bottom - r.top > top && c.top - r.top < bottom;
        })
        .map((el) => el.dataset.clipId!);
      const next = [...new Set([...base, ...hit])];
      const cur = ed().selection;
      if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) ed().select(next);
    };
    const scroll = autoScroll(update, true);
    const move = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      scroll.follow(ev);
      update();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      scroll.stop();
      box.style.display = "none";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // 창 밖에서 놓아도 끝을 받도록 포인터를 붙잡는다 (안 그러면 끌기·자동 스크롤이 멈추지 않는다)
    capture(e);
  };

  const onClipPointer = (e: React.PointerEvent, clip: Clip, track: Track, mode: "move" | "left" | "right") => {
    // 우클릭: 선택에 없는 클립이면 그 클립만 고르고 메뉴는 contextmenu에서 연다 (여러 개 고른 채 우클릭하면 전부에 적용)
    if (e.button === 2) {
      e.stopPropagation();
      if (!ed().selection.includes(clip.id)) ed().select([clip.id]);
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = ed();
    if (e.ctrlKey || e.shiftKey) {
      s.select(s.selection.includes(clip.id) ? s.selection.filter((x) => x !== clip.id) : [...s.selection, clip.id]);
      return;
    }
    // 여러 개 고른 채 그중 하나를 끌면 함께 옮긴다 (자석 켠 메인 트랙·잠긴 트랙의 클립은 제외)
    const group =
      mode === "move" && s.selection.length > 1 && s.selection.includes(clip.id)
        ? s.selection.map((id) => findClip(s.project, id)).filter((f): f is { track: Track; clip: Clip } => !!f && !f.track.locked && !(f.track.main && s.magnet)).map((f) => f.clip)
        : [];
    const together = group.length > 1 && group.some((c) => c.id === clip.id);
    if (!together && (!s.selection.includes(clip.id) || s.selection.length > 1)) s.select([clip.id]);
    if (track.locked) return;
    const x0 = e.clientX;
    const grabOffset = timeAt(e.clientX) - clip.start;
    const points = snapPoints(s.project, together ? group.map((c) => c.id) : [clip.id], s.playhead);
    const earliest = Math.min(...group.map((c) => c.start));
    const threshold = SNAP_PX / s.zoom;
    const layout = s.project.tracks;
    const newTrackId = uid("trk");
    let started = false;
    let px = e.clientX;
    let py = e.clientY;
    // 자동 스크롤로 내용이 움직이면 같은 포인터 위치로 다시 계산한다 (포인터 밑의 시간이 바뀌므로)
    const scroll = autoScroll(() => drag(), mode === "move" && !together);
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3 && mode === "move" && Math.abs(ev.movementY) < 3) return;
        started = true;
        ed().beginGesture();
      }
      px = ev.clientX;
      py = ev.clientY;
      scroll.follow(ev);
      drag();
    };
    const drag = () => {
      const st = ed();
      const t = timeAt(px);
      if (mode === "move") {
        let start = t - grabOffset;
        let line: number | undefined; // 달라붙은 경계 위치
        if (st.snapping) {
          const a = snap(start, points, threshold);
          const b = snap(start + clip.duration, points, threshold);
          if (a !== undefined && (b === undefined || Math.abs(a - start) <= Math.abs(b - start - clip.duration))) {
            start = a;
            line = a;
          } else if (b !== undefined) {
            start = b - clip.duration;
            line = b;
          }
        }
        showSnap(line);
        if (together) {
          const dt = Math.max(start - clip.start, -earliest);
          st.updateGesture((p) => group.reduce((acc, g) => mapClip(acc, g.id, (c) => ({ ...c, start: g.start + dt })), p));
          return;
        }
        const target = trackAt(py, layout);
        st.updateGesture((p) => moveClip(p, clip.id, target, start, st.magnet, { allowOverlap: true, newTrackId }));
      } else {
        let edgeT = t;
        const sp = st.snapping ? snap(edgeT, points, threshold) : undefined;
        if (sp !== undefined) edgeT = sp;
        showSnap(sp);
        st.updateGesture((p) => trimClip(p, clip.id, mode, edgeT));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      scroll.stop();
      showSnap(undefined);
      // 놓은 자리가 다른 클립과 겹치면 그 트랙 바로 위에 새 트랙을 만든다
      if (started) ed().endGesture(mode !== "move" ? undefined : together ? (p) => group.reduce((acc, g) => resolveOverlap(acc, g.id), p) : (p) => resolveOverlap(p, clip.id));
      // 끌지 않고 클릭만 했으면 그 클립 하나만 고른다
      else if (together) ed().select([clip.id]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    // 창 밖에서 놓아도 끝을 받도록 포인터를 붙잡는다 (안 그러면 끌기·자동 스크롤이 멈추지 않는다)
    capture(e);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const s = ed();
    const t = timeAt(e.clientX);
    const target = trackAt(e.clientY);
    // 전환을 트랙 위에 놓으면 그 트랙에서 놓은 자리와 가장 가까운 컷에 넣는다
    if (e.dataTransfer.types.includes(TRANSITION_DND)) {
      const cuts = adjacentPairs(s.project.tracks.find((x) => x.id === target) ?? s.project.tracks.find((x) => x.main)!).map(([a]) => a);
      if (!cuts.length) return s.notify("전환은 같은 트랙에서 붙어 있는 두 영상/사진 클립 사이에 들어갑니다");
      return dropTransition(e, cuts.reduce((best, c) => (Math.abs(clipEnd(c) - t) < Math.abs(clipEnd(best) - t) ? c : best)));
    }
    let ids: string[] = [];
    const mediaId = e.dataTransfer.getData(MEDIA_DND);
    if (mediaId) ids = [mediaId];
    else if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => window.zapcut.pathForFile(f)).filter(Boolean);
      ids = (await s.importFiles(paths)).map((m) => m.id);
    }
    let at = t;
    for (const id of ids) {
      const m = ed().project.media.find((x) => x.id === id);
      if (!m) continue;
      const clip = clipFromMedia(m, at);
      ed().commit((p) => (target === "new" ? placeClip(p, clip, undefined, m.kind !== "audio") : moveClip(placeClip(p, clip, target), clip.id, target, at, ed().magnet)));
      ed().select([clip.id]);
      at += clip.duration;
    }
  };

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <div className="tool-group">
          <button className="icon-btn" title="실행 취소 (Ctrl+Z)" disabled={!canUndo} onClick={() => ed().undo()}>
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" title="다시 실행 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => ed().redo()}>
            <Redo2 size={16} />
          </button>
          <span className="sep" />
          <button className="icon-btn" title="분할 (Ctrl+B)" onClick={() => ed().splitAtPlayhead()}>
            <Scissors size={16} />
          </button>
          <button className="icon-btn" title="왼쪽 삭제 (Q)" onClick={() => ed().trimSide("left")}>
            <ArrowLeftToLine size={16} />
          </button>
          <button className="icon-btn" title="오른쪽 삭제 (W)" onClick={() => ed().trimSide("right")}>
            <ArrowRightToLine size={16} />
          </button>
          <button className="icon-btn" title="삭제 (Delete)" onClick={() => ed().deleteSelected()}>
            <Trash2 size={16} />
          </button>
          <button className="icon-btn" title="오디오 분리: 선택한 영상 클립의 소리를 오디오 트랙으로 떼어 냄" onClick={() => ed().detachSelectedAudio()}>
            <AudioLines size={16} />
          </button>
          <span className="sep" />
          <button className="icon-btn" title="전체 선택 (Ctrl+A) · Ctrl+클릭 또는 빈 곳에서 끌어 여러 개 고를 수 있습니다" onClick={() => ed().select(project.tracks.flatMap((t) => t.clips.map((c) => c.id)))}>
            <ListChecks size={16} />
          </button>
        </div>
        <div className="tool-group">
          <button className={`icon-btn toggle ${magnet ? "on" : ""}`} title="메인 트랙 자석" onClick={() => ed().toggleMagnet()}>
            <Magnet size={16} />
          </button>
          <button className={`icon-btn toggle ${snapping ? "on" : ""}`} title="스냅 (N)" onClick={() => ed().toggleSnapping()}>
            <SquareSplitHorizontal size={16} />
          </button>
          <span className="sep" />
          <button className="icon-btn" title="축소 (Ctrl+-)" onClick={() => ed().setZoom(zoom / 1.25)}>
            <ZoomOut size={16} />
          </button>
          <input className="zoom" type="range" min={Math.log(4)} max={Math.log(400)} step={0.01} value={Math.log(zoom)} onChange={(e) => ed().setZoom(Math.exp(+e.target.value))} />
          <button className="icon-btn" title="확대 (Ctrl+=)" onClick={() => ed().setZoom(zoom * 1.25)}>
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div className="timeline-scroll" ref={scrollRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="timeline-inner" style={{ width: width + HEADER_W }}>
          <div className="track-headers">
            <div className="ruler-spacer" style={{ height: RULER_H }} />
            {project.tracks.map((t) => (
              <div key={t.id} className={`track-header ${t.main ? "main" : ""}`} style={{ height: trackHeight(t) }}>
                {t.main && <span className="main-badge">메인</span>}
                <button className="mini" title={t.locked ? "잠금 해제" : "트랙 잠금"} onClick={() => ed().updateTrack(t.id, { locked: !t.locked })}>
                  {t.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                {t.kind !== "audio" && (
                  <button className="mini" title={t.hidden ? "보이기" : "숨기기"} onClick={() => ed().updateTrack(t.id, { hidden: !t.hidden })}>
                    {t.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
                {t.kind !== "text" && t.kind !== "effect" && (
                  <button className="mini" title={t.muted ? "음소거 해제" : "음소거"} onClick={() => ed().updateTrack(t.id, { muted: !t.muted })}>
                    {t.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="track-content" ref={contentRef} style={{ width }}>
            <div onPointerDown={startScrub}>
              <Ruler width={width} zoom={zoom} />
            </div>
            <div className="tracks" onPointerDown={startMarquee}>
              {project.tracks.map((t) => (
                <div key={t.id} className={`track ${t.kind} ${t.main ? "main" : ""} ${t.locked ? "locked" : ""} ${t.hidden ? "hidden" : ""}`} style={{ height: trackHeight(t) }}>
                  {t.main && t.clips.length === 0 && <div className="main-empty">미디어를 여기로 끌어 놓으세요</div>}
                  {t.clips.map((c) => (
                    <ClipView
                      key={c.id}
                      clip={c}
                      track={t}
                      media={project.media.find((m) => m.id === c.mediaId)}
                      onPointerDown={(e, mode) => onClipPointer(e, c, t, mode)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}
                  {t.kind === "video" &&
                    adjacentPairs(t).map(([c]) => {
                      const tr = findTransition(c.transition?.id);
                      return (
                        <button
                          key={`tr-${c.id}`}
                          className={`cut-marker ${tr ? "has" : ""}`}
                          style={{ left: clipEnd(c) * zoom }}
                          title={tr ? `전환: ${tr.name} (${c.transition!.duration.toFixed(1)}초)` : "전환 추가"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onDragOver={(e) => e.dataTransfer.types.includes(TRANSITION_DND) && e.preventDefault()}
                          onDrop={(e) => dropTransition(e, c)}
                          onClick={() => {
                            ed().select([c.id]);
                            ed().setTab("transition");
                          }}
                        >
                          {tr ? "⇄" : "+"}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
            <div className="playhead" style={{ left: playhead * zoom }} />
            <div className="snap-line" ref={snapLine} />
            <div className="marquee" ref={marquee} />
            {total > 0 && <div className="end-marker" style={{ left: total * zoom }} />}
            {silence?.project === project && silence.ranges.map((r, i) => <div key={i} className="silence-band" style={{ left: r.a * zoom, width: Math.max(2, (r.b - r.a) * zoom) }} title="무음 구간 (잘라내기 미리 보기)" />)}
          </div>
        </div>
      </div>
      {menu && <ClipMenu x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  );
}
