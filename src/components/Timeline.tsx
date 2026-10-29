import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Eye,
  EyeOff,
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
import { useEffect, useLayoutEffect, useRef } from "react";
import { clipFromMedia, moveClip, placeClip, projectDuration, snap, snapPoints, trimClip } from "../core/timeline";
import type { Clip, MediaItem, Track } from "../core/types";
import { WAVE_RATE } from "../core/types";
import { mediaUrl, useEditor } from "../editor/store";
import { shortTime } from "./format";

const HEADER_W = 96;
const RULER_H = 28;
const SNAP_PX = 8;
export const MEDIA_DND = "application/x-zapcut-media";

const trackHeight = (t: Track) => (t.main ? 76 : t.kind === "text" ? 34 : t.kind === "audio" ? 50 : 58);

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

function ClipView({ clip, track, media, onPointerDown }: { clip: Clip; track: Track; media?: MediaItem; onPointerDown: (e: React.PointerEvent, mode: "move" | "left" | "right") => void }) {
  const zoom = useEditor((s) => s.zoom);
  const selected = useEditor((s) => s.selection.includes(clip.id));
  const h = trackHeight(track) - 6;
  const style: React.CSSProperties = { left: clip.start * zoom, width: Math.max(2, clip.duration * zoom), height: h };
  let bg: React.CSSProperties = {};
  if (media?.filmstrip && media.kind === "video") {
    const stripW = (media.duration / clip.speed) * zoom;
    bg = { backgroundImage: `url("${mediaUrl(media.filmstrip)}")`, backgroundSize: `${stripW}px 100%`, backgroundPosition: `${-(clip.in / clip.speed) * zoom}px 0`, backgroundRepeat: "no-repeat" };
  } else if (media?.thumbnail && media.kind === "image") {
    bg = { backgroundImage: `url("${mediaUrl(media.thumbnail)}")`, backgroundSize: `auto 100%`, backgroundRepeat: "repeat-x" };
  }
  const label = clip.kind === "text" ? clip.text?.content : media?.name;
  return (
    <div className={`clip ${clip.kind} ${selected ? "selected" : ""}`} style={style} onPointerDown={(e) => onPointerDown(e, "move")}>
      <div className="clip-body" style={bg}>
        <span className="clip-label">
          {clip.speed !== 1 && <b>{clip.speed.toFixed(2)}x </b>}
          {label}
        </span>
        {media && (clip.kind === "audio" || (clip.kind === "video" && media.hasAudio)) && (
          <Waveform media={media} clip={clip} height={clip.kind === "audio" ? h - 16 : 16} />
        )}
      </div>
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
  const playing = useEditor((s) => s.playing);
  const magnet = useEditor((s) => s.magnet);
  const snapping = useEditor((s) => s.snapping);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const snapLine = useRef<HTMLDivElement>(null);
  const total = projectDuration(project);
  const width = Math.max((total + 30) * zoom, (scrollRef.current?.clientWidth ?? 1200) - HEADER_W);
  const ed = useEditor.getState;

  // 재생 중 재생헤드가 화면 밖으로 나가면 스크롤
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = playhead * zoom;
    const view = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
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
  const trackAt = (clientY: number): string | "new" => {
    const rect = contentRef.current!.getBoundingClientRect();
    let y = clientY - rect.top - RULER_H;
    if (y < 0) return "new";
    for (const t of ed().project.tracks) {
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

  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = ed();
    s.setPlayhead(timeAt(e.clientX));
    const move = (ev: PointerEvent) => ed().setPlayhead(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClipPointer = (e: React.PointerEvent, clip: Clip, track: Track, mode: "move" | "left" | "right") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = ed();
    if (e.ctrlKey || e.shiftKey) {
      s.select(s.selection.includes(clip.id) ? s.selection.filter((x) => x !== clip.id) : [...s.selection, clip.id]);
      return;
    }
    if (!s.selection.includes(clip.id) || s.selection.length > 1) s.select([clip.id]);
    if (track.locked) return;
    const x0 = e.clientX;
    const grabOffset = timeAt(e.clientX) - clip.start;
    const points = snapPoints(s.project, [clip.id], s.playhead);
    const threshold = SNAP_PX / s.zoom;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < 3 && mode === "move" && Math.abs(ev.movementY) < 3) return;
        started = true;
        ed().beginGesture();
      }
      const st = ed();
      const t = timeAt(ev.clientX);
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
        const target = trackAt(ev.clientY);
        st.updateGesture((p) => moveClip(p, clip.id, target, start, st.magnet));
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
      showSnap(undefined);
      if (started) ed().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const s = ed();
    const t = timeAt(e.clientX);
    const target = trackAt(e.clientY);
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
                {t.kind !== "text" && (
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
            <div
              className="tracks"
              onPointerDown={(e) => {
                ed().select([]);
                startScrub(e);
              }}
            >
              {project.tracks.map((t) => (
                <div key={t.id} className={`track ${t.kind} ${t.main ? "main" : ""} ${t.locked ? "locked" : ""} ${t.hidden ? "hidden" : ""}`} style={{ height: trackHeight(t) }}>
                  {t.main && t.clips.length === 0 && <div className="main-empty">미디어를 여기로 끌어 놓으세요</div>}
                  {t.clips.map((c) => (
                    <ClipView key={c.id} clip={c} track={t} media={project.media.find((m) => m.id === c.mediaId)} onPointerDown={(e, mode) => onClipPointer(e, c, t, mode)} />
                  ))}
                </div>
              ))}
            </div>
            <div className="playhead" style={{ left: playhead * zoom }} />
            <div className="snap-line" ref={snapLine} />
            {total > 0 && <div className="end-marker" style={{ left: total * zoom }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
