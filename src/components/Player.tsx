import { Maximize, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { mediaBox, drawMedia, drawText, measureText } from "../core/render";
import { clipEnd, findClip, projectDuration, visibleClipsAt } from "../core/timeline";
import type { Clip, MediaItem, Project } from "../core/types";
import { mediaUrl, useEditor } from "../editor/store";
import { formatTime } from "./format";

const PREVIEW_MAX_H = 720;
const RATIOS: { label: string; w: number; h: number }[] = [
  { label: "16:9", w: 1920, h: 1080 },
  { label: "9:16", w: 1080, h: 1920 },
  { label: "1:1", w: 1080, h: 1080 },
  { label: "4:3", w: 1440, h: 1080 },
  { label: "3:4", w: 1080, h: 1440 },
  { label: "21:9", w: 2520, h: 1080 },
];

type MediaEl = HTMLVideoElement | HTMLAudioElement;

/** 클립별 미디어 요소 풀 */
class Pool {
  els = new Map<string, MediaEl>();
  images = new Map<string, HTMLImageElement>();
  onFrame: () => void = () => undefined;

  media(clip: Clip, m: MediaItem): MediaEl {
    let el = this.els.get(clip.id);
    if (!el) {
      el = clip.kind === "audio" ? new Audio() : document.createElement("video");
      el.preload = "auto";
      el.src = mediaUrl(m.path);
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

export function Player() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef(new Pool());
  const clock = useRef({ startT: 0, startNow: 0 });
  const dirty = useRef(true);
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const [overlay, setOverlay] = useState<{ x: number; y: number; w: number; h: number; rot: number } | null>(null);
  const total = projectDuration(project);
  const size = previewSize(project);

  // 프레임 그리기 + 동기화 루프
  useEffect(() => {
    const pool = poolRef.current;
    pool.onFrame = () => (dirty.current = true);
    let raf = 0;
    let selfSet = false;
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
      sync(p, t, st.playing);
      if (dirty.current) {
        dirty.current = false;
        draw(p, t);
      }
    };
    const sync = (p: Project, t: number, isPlaying: boolean) => {
      const active = new Set<string>();
      const live = new Set<string>();
      for (const track of p.tracks) {
        for (const clip of track.clips) {
          if (clip.kind !== "video" && clip.kind !== "audio") continue;
          live.add(clip.id);
          const m = p.media.find((x) => x.id === clip.mediaId);
          if (!m) continue;
          const inside = t >= clip.start && t < clipEnd(clip);
          const upcoming = clip.start - t > 0 && clip.start - t < 1.5;
          if (!inside && !upcoming) continue;
          const el = pool.media(clip, m);
          if (upcoming) {
            if (!el.paused) el.pause();
            if (Math.abs(el.currentTime - clip.in) > 0.05 && el.readyState >= 1) el.currentTime = clip.in;
            continue;
          }
          active.add(clip.id);
          const expected = clip.in + (t - clip.start) * clip.speed;
          const local = t - clip.start;
          let fade = 1;
          if (clip.fadeIn > 0) fade = Math.min(fade, local / clip.fadeIn);
          if (clip.fadeOut > 0) fade = Math.min(fade, (clip.duration - local) / clip.fadeOut);
          el.volume = Math.max(0, Math.min(1, clip.volume * fade));
          el.muted = clip.muted || track.muted;
          if (isPlaying) {
            if (Math.abs(el.playbackRate - clip.speed) > 1e-3) el.playbackRate = clip.speed;
            if (el.paused) {
              el.currentTime = expected;
              el.play().catch(() => undefined);
            } else if (Math.abs(el.currentTime - expected) > 0.3) el.currentTime = expected;
          } else {
            if (!el.paused) el.pause();
            if (Math.abs(el.currentTime - expected) > 1 / (m.fps || 30) / 2 && !el.seeking) el.currentTime = expected;
          }
        }
      }
      pool.pauseAll(active);
      pool.prune(live);
    };
    const draw = (p: Project, t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const W = canvas.width;
      const H = canvas.height;
      ctx.fillStyle = p.background;
      ctx.fillRect(0, 0, W, H);
      for (const { clip } of visibleClipsAt(p, t)) {
        if (clip.kind === "text") {
          drawText(ctx, W, H, clip);
          continue;
        }
        const m = p.media.find((x) => x.id === clip.mediaId);
        if (!m) continue;
        if (clip.kind === "image") {
          const img = pool.image(m);
          if (img.complete && img.naturalWidth) drawMedia(ctx, img, img.naturalWidth, img.naturalHeight, W, H, clip);
        } else if (clip.kind === "video") {
          const el = pool.media(clip, m) as HTMLVideoElement;
          if (el.readyState >= 2 && el.videoWidth) drawMedia(ctx, el, el.videoWidth, el.videoHeight, W, H, clip);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.playhead !== prev.playhead) dirty.current = true;
      if (s.playing && !prev.playing) clock.current = { startT: s.playhead >= projectDuration(s.project) - 0.01 ? 0 : s.playhead, startNow: performance.now() };
      // 재생 중 사용자가 재생헤드를 옮긴 경우 시계를 다시 맞춘다
      else if (s.playing && s.playhead !== prev.playhead && !selfSet) clock.current = { startT: s.playhead, startNow: performance.now() };
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
      pool.pauseAll(new Set());
    };
  }, []);

  useEffect(() => {
    dirty.current = true;
  }, [size.w, size.h]);

  // 선택한 클립의 화면상 상자 계산
  useEffect(() => {
    const canvas = canvasRef.current;
    const sel = selection.length === 1 ? findClip(project, selection[0]) : undefined;
    if (!canvas || !sel || sel.clip.kind === "audio" || playhead < sel.clip.start || playhead >= clipEnd(sel.clip)) return setOverlay(null);
    const { clip } = sel;
    const W = canvas.width;
    const H = canvas.height;
    let box: { cx: number; cy: number; w: number; h: number };
    if (clip.kind === "text" && clip.text) {
      const m = measureText(canvas.getContext("2d")!, clip.text, H, clip.transform);
      box = { cx: W / 2 + clip.transform.x * W, cy: H / 2 + clip.transform.y * H, w: m.w, h: m.h };
    } else {
      const m = project.media.find((x) => x.id === clip.mediaId);
      if (!m) return setOverlay(null);
      box = mediaBox(m.width || W, m.height || H, W, H, clip.transform);
    }
    const k = canvas.clientWidth / W;
    setOverlay({ x: box.cx * k, y: box.cy * k, w: box.w * k, h: box.h * k, rot: clip.transform.rotation });
  }, [selection, project, playhead, size.w, size.h]);

  const dragTransform = (e: React.PointerEvent, mode: "move" | "scale") => {
    e.preventDefault();
    e.stopPropagation();
    const st = useEditor.getState();
    const sel = findClip(st.project, st.selection[0]);
    const canvas = canvasRef.current;
    if (!sel || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const t0 = sel.clip.transform;
    const sx = e.clientX;
    const sy = e.clientY;
    const cx = rect.left + (0.5 + t0.x) * rect.width;
    const cy = rect.top + (0.5 + t0.y) * rect.height;
    const d0 = Math.hypot(sx - cx, sy - cy) || 1;
    st.beginGesture();
    const move = (ev: PointerEvent) => {
      const id = sel.clip.id;
      if (mode === "move") {
        let x = t0.x + (ev.clientX - sx) / rect.width;
        let y = t0.y + (ev.clientY - sy) / rect.height;
        // 중앙 스냅
        if (Math.abs(x) < 0.01) x = 0;
        if (Math.abs(y) < 0.01) y = 0;
        st.updateGesture((p) => ({ ...p, tracks: p.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === id ? { ...c, transform: { ...c.transform, x, y } } : c)) })) }));
      } else {
        const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        const scale = Math.max(0.05, Math.min(10, t0.scale * (d / d0)));
        st.updateGesture((p) => ({ ...p, tracks: p.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => (c.id === id ? { ...c, transform: { ...c.transform, scale } } : c)) })) }));
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

  return (
    <div className="player" ref={wrapRef}>
      <div className="panel-title">플레이어</div>
      <div className="player-stage" onPointerDown={() => useEditor.getState().select([])}>
        <div className="canvas-wrap" style={{ "--ar": project.width / project.height } as React.CSSProperties}>
          <canvas ref={canvasRef} width={size.w} height={size.h} />
          {overlay && (
            <div
              className="transform-box"
              style={{ left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h, transform: `translate(-50%, -50%) rotate(${overlay.rot}deg)` }}
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
              if (r) useEditor.getState().setProjectProps({ width: r.w, height: r.h });
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
