import { Maximize, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { compile } from "../core/expr";
import { volumeExpr } from "../core/motion";
import { canvasSize, clipEnd, findClip, projectDuration, RATIOS } from "../core/timeline";
import type { Clip, MediaItem, Project } from "../core/types";
import { mediaUrl, useEditor } from "../editor/store";
import { Compositor, type LayerBox } from "../preview/compositor";
import { frameAt, type Frame } from "../preview/frame";
import { formatTime } from "./format";

const PREVIEW_MAX_H = 720;

type MediaEl = HTMLVideoElement | HTMLAudioElement;

/** 클립별 미디어 요소 풀 */
class Pool {
  els = new Map<string, MediaEl>();
  images = new Map<string, HTMLImageElement>();
  onFrame: () => void = () => undefined;

  media(clip: Clip, m: MediaItem): MediaEl {
    let el = this.els.get(clip.id);
    const src = mediaUrl(m.kind === "video" && m.proxy ? m.proxy : m.path);
    if (el && el.dataset.src !== src) {
      el.pause();
      el.src = src;
      el.dataset.src = src;
    }
    if (!el) {
      el = clip.kind === "audio" ? new Audio() : document.createElement("video");
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.src = src;
      el.dataset.src = src;
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.addEventListener("seeked", () => this.onFrame());
      el.addEventListener("loadeddata", () => this.onFrame());
      this.els.set(clip.id, el);
    }
    return el;
  }
  image(m: MediaItem) {
    let img = this.images.get(m.id);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.src = mediaUrl(m.path);
      img.onload = () => this.onFrame();
      this.images.set(m.id, img);
    }
    return img;
  }
  prune(liveIds: Set<string>) {
    for (const [id, el] of this.els)
      if (!liveIds.has(id)) {
        el.pause();
        el.removeAttribute("src");
        el.load();
        this.els.delete(id);
      }
  }
  pauseAll(except: Set<string>) {
    for (const [id, el] of this.els) if (!except.has(id) && !el.paused) el.pause();
  }
}

function previewSize(p: Project) {
  const scale = Math.min(1, PREVIEW_MAX_H / p.height);
  return { w: Math.round(p.width * scale), h: Math.round(p.height * scale) };
}

interface Use {
  clip: Clip;
  media: MediaItem;
  T: number; // 클립 내부 시간
  audible: boolean;
}

/** 지금 재생해야 할 미디어 요소 목록 (화면 레이어 + 들리는 클립) */
function mediaUses(p: Project, t: number, frame: Frame): Use[] {
  const out = new Map<string, Use>();
  const mediaOf = (c: Clip) => (c.mediaId ? p.media.find((m) => m.id === c.mediaId) : undefined);
  for (const l of frame.layers) {
    if (l.clip.kind !== "video" || !l.media) continue;
    out.set(l.clip.id, { clip: l.clip, media: l.media, T: l.T, audible: false });
  }
  for (const track of p.tracks) {
    if (track.kind === "text" || track.kind === "effect") continue;
    for (const c of track.clips) {
      if ((c.kind !== "video" && c.kind !== "audio") || t < c.start || t >= clipEnd(c)) continue;
      const m = mediaOf(c);
      if (!m) continue;
      const audible = !track.muted && !c.muted;
      const prev = out.get(c.id);
      out.set(c.id, { clip: c, media: m, T: t - c.start, audible: audible || !!prev?.audible });
    }
  }
  return [...out.values()];
}

export function Player() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef(new Pool());
  const compRef = useRef<Compositor | null>(null);
  const boxesRef = useRef(new Map<string, LayerBox>());
  const clock = useRef({ startT: 0, startNow: 0 });
  const dirty = useRef(true);
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const [overlay, setOverlay] = useState<LayerBox & { k: number } | null>(null);
  const [glError, setGlError] = useState<string>();
  const total = projectDuration(project);
  const size = previewSize(project);

  useEffect(() => {
    const pool = poolRef.current;
    pool.onFrame = () => (dirty.current = true);
    try {
      compRef.current = new Compositor(canvasRef.current!);
    } catch (e) {
      setGlError((e as Error).message);
      return;
    }
    let raf = 0;
    let selfSet = false;
    let lastBoxesKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = useEditor.getState();
      const p = st.project;
      let t = st.playhead;
      if (st.playing) {
        t = clock.current.startT + (performance.now() - clock.current.startNow) / 1000;
        const end = projectDuration(p);
        if (t >= end) {
          t = end;
          st.setPlaying(false);
        }
        selfSet = true;
        st.setPlayhead(t);
        selfSet = false;
        dirty.current = true;
      }
      const frame = frameAt(p, t);
      const anyPlaying = sync(p, t, st.playing, frame);
      if (dirty.current || anyPlaying) {
        dirty.current = false;
        const comp = compRef.current!;
        const sz = previewSize(p);
        comp.resize(sz.w, sz.h);
        boxesRef.current = comp.render(frame, p.background, (layer) => {
          const m = layer.media;
          if (!m) return undefined;
          if (layer.clip.kind === "image") {
            const img = pool.image(m);
            return img.complete && img.naturalWidth ? img : undefined;
          }
          const el = pool.els.get(layer.clip.id) as HTMLVideoElement | undefined;
          return el && el.readyState >= 2 && el.videoWidth ? el : undefined;
        });
        // 선택 상자 갱신 (값이 바뀔 때만)
        const sel = st.selection.length === 1 ? boxesRef.current.get(st.selection[0]) : undefined;
        const key = sel ? `${sel.cx.toFixed(1)},${sel.cy.toFixed(1)},${sel.w.toFixed(1)},${sel.h.toFixed(1)},${sel.rot.toFixed(1)}` : "";
        if (key !== lastBoxesKey) {
          lastBoxesKey = key;
          const canvas = canvasRef.current!;
          setOverlay(sel ? { ...sel, k: canvas.clientWidth / comp.W } : null);
        }
      }
    };
    const sync = (p: Project, t: number, isPlaying: boolean, frame: Frame) => {
      const active = new Set<string>();
      const live = new Set<string>();
      for (const tr of p.tracks) for (const c of tr.clips) if (c.kind === "video" || c.kind === "audio") live.add(c.id);
      let anyPlaying = false;
      for (const u of mediaUses(p, t, frame)) {
        const el = pool.media(u.clip, u.media);
        active.add(u.clip.id);
        const dur = u.media.duration || Infinity;
        const raw = u.clip.in + u.T * u.clip.speed;
        const expected = Math.min(Math.max(0, raw), dur - 0.04);
        const frozen = raw < 0 || raw > dur - 0.04; // 전환 여유 구간에서 원본이 모자라면 정지 화면
        const inside = u.T >= 0 && u.T < u.clip.duration;
        let vol = 0;
        if (u.audible && inside) {
          const local = u.T;
          vol = compile(volumeExpr(u.clip))({ T: local });
          if (u.clip.fadeIn > 0) vol *= Math.min(1, local / u.clip.fadeIn);
          if (u.clip.fadeOut > 0) vol *= Math.min(1, (u.clip.duration - local) / u.clip.fadeOut);
        }
        el.volume = Math.max(0, Math.min(1, vol));
        el.muted = vol <= 0;
        if (isPlaying && !frozen) {
          if (Math.abs(el.playbackRate - u.clip.speed) > 1e-3) el.playbackRate = u.clip.speed;
          if (el.paused) {
            el.currentTime = expected;
            el.play().catch(() => undefined);
          } else if (Math.abs(el.currentTime - expected) > 0.3) el.currentTime = expected;
          anyPlaying = true;
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - expected) > 1 / (u.media.fps || 30) / 2 && !el.seeking) el.currentTime = expected;
        }
      }
      // 곧 시작할 클립 미리 준비
      for (const tr of p.tracks)
        for (const c of tr.clips) {
          if ((c.kind !== "video" && c.kind !== "audio") || active.has(c.id)) continue;
          const lead = c.start - t;
          if (lead <= 0 || lead > 1.5) continue;
          const m = p.media.find((x) => x.id === c.mediaId);
          if (!m) continue;
          const el = pool.media(c, m);
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - c.in) > 0.05 && el.readyState >= 1) el.currentTime = c.in;
          active.add(c.id);
        }
      pool.pauseAll(active);
      pool.prune(live);
      return anyPlaying;
    };
    raf = requestAnimationFrame(tick);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.playhead !== prev.playhead || s.selection !== prev.selection) dirty.current = true;
      if (s.playing && !prev.playing) clock.current = { startT: s.playhead >= projectDuration(s.project) - 0.01 ? 0 : s.playhead, startNow: performance.now() };
      else if (s.playing && s.playhead !== prev.playhead && !selfSet) clock.current = { startT: s.playhead, startNow: performance.now() };
      if (s.project !== prev.project) {
        const clipIds = new Set(s.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
        compRef.current?.prune(clipIds, new Set(s.project.media.map((m) => m.id)));
      }
    });
    const onResize = () => (dirty.current = true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      window.removeEventListener("resize", onResize);
      pool.pauseAll(new Set());
    };
  }, []);

  // 외부 LUT(.cube) 파일 불러오기
  useEffect(() => {
    const comp = compRef.current;
    if (!comp) return;
    for (const t of project.tracks)
      for (const c of t.clips)
        if (c.lut && !comp.externalLuts.has(c.lut.path))
          window.zapcut.readCube(c.lut.path).then((lut) => {
            if (lut) {
              comp.externalLuts.set(c.lut!.path, lut);
              dirty.current = true;
            }
          });
  }, [project]);

  const dragTransform = (e: React.PointerEvent, mode: "move" | "scale") => {
    e.preventDefault();
    e.stopPropagation();
    const st = useEditor.getState();
    const found = findClip(st.project, st.selection[0]);
    const canvas = canvasRef.current;
    const box = boxesRef.current.get(st.selection[0]);
    if (!found || !canvas || !box || !compRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const k = rect.width / compRef.current.W;
    const T = st.playhead - found.clip.start;
    const x0 = (box.cx / compRef.current.W) - 0.5;
    const y0 = (box.cy / compRef.current.H) - 0.5;
    const base = { x: st.valueAt(found.clip, "x", T), y: st.valueAt(found.clip, "y", T), scale: st.valueAt(found.clip, "scale", T) };
    const sx = e.clientX;
    const sy = e.clientY;
    const cx = rect.left + box.cx * k;
    const cy = rect.top + box.cy * k;
    const d0 = Math.hypot(sx - cx, sy - cy) || 1;
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const s = useEditor.getState();
      if (mode === "move") {
        let nx = base.x + (ev.clientX - sx) / rect.width;
        let ny = base.y + (ev.clientY - sy) / rect.height;
        // 화면 중앙 스냅 (애니메이션 오프셋 포함 실제 위치 기준)
        if (Math.abs(x0 + (nx - base.x)) < 0.01) nx = base.x - x0;
        if (Math.abs(y0 + (ny - base.y)) < 0.01) ny = base.y - y0;
        s.setClipProps(found.clip.id, { x: nx, y: ny }, true);
      } else {
        const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        s.setClipProps(found.clip.id, { scale: Math.max(0.05, Math.min(10, base.scale * (d / d0))) }, true);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const togglePlay = () => useEditor.getState().setPlaying(!playing);
  const ratioLabel = RATIOS.find((r) => Math.abs(r.w / r.h - project.width / project.height) < 0.01)?.label ?? "원본";
  const showBox = overlay && selection.length === 1;

  return (
    <div className="player" ref={wrapRef}>
      <div className="panel-title">플레이어</div>
      <div className="player-stage" onPointerDown={() => useEditor.getState().select([])}>
        <div className="canvas-wrap" style={{ "--ar": project.width / project.height } as React.CSSProperties}>
          <canvas ref={canvasRef} width={size.w} height={size.h} />
          {glError && <div className="gl-error">미리보기를 시작할 수 없습니다: {glError}</div>}
          {showBox && (
            <div
              className="transform-box"
              style={{ left: overlay.cx * overlay.k, top: overlay.cy * overlay.k, width: overlay.w * overlay.k, height: overlay.h * overlay.k, transform: `translate(-50%, -50%) rotate(${overlay.rot}deg)` }}
              onPointerDown={(e) => dragTransform(e, "move")}
            >
              {["nw", "ne", "sw", "se"].map((h) => (
                <span key={h} className={`handle ${h}`} onPointerDown={(e) => dragTransform(e, "scale")} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="player-bar">
        <span className="timecode">
          <b>{formatTime(playhead, project.fps)}</b> / {formatTime(total, project.fps)}
        </span>
        <div className="player-controls">
          <button className="icon-btn" title="이전 편집점 (↑)" onClick={() => useEditor.getState().jumpEdit(-1)}>
            <SkipBack size={16} />
          </button>
          <button className="icon-btn play" title="재생/정지 (Space)" onClick={togglePlay}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button className="icon-btn" title="다음 편집점 (↓)" onClick={() => useEditor.getState().jumpEdit(1)}>
            <SkipForward size={16} />
          </button>
        </div>
        <div className="player-right">
          <select
            className="ratio"
            title="화면 비율"
            value={ratioLabel}
            onChange={(e) => {
              const r = RATIOS.find((x) => x.label === e.target.value);
              if (r) useEditor.getState().setProjectProps(canvasSize(r.w, r.h, Math.min(project.width, project.height)));
            }}
          >
            {ratioLabel === "원본" && <option value="원본">원본</option>}
            {RATIOS.map((r) => (
              <option key={r.label} value={r.label}>
                {r.label}
              </option>
            ))}
          </select>
          <button className="icon-btn" title="전체 화면" onClick={() => wrapRef.current?.querySelector(".player-stage")?.requestFullscreen()}>
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
