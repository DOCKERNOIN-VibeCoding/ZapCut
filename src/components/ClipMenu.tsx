// 타임라인 클립 우클릭 메뉴: 선택한 클립에 바로 실행하는 동작들
import { ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clipEnd, findClip, mapClip } from "../core/timeline";
import type { Clip } from "../core/types";
import { freezeFrame, reverseClip } from "../editor/actions";
import { autoCaption } from "../editor/captions";
import { useEditor } from "../editor/store";
import { loadCaptionPrefs } from "./CaptionPanel";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const s = useEditor.getState;

function Item({ label, keys, disabled, title, checked, onClick }: { label: string; keys?: string; disabled?: boolean; title?: string; checked?: boolean; onClick: () => void }) {
  return (
    <button className="ctx-item" disabled={disabled} title={title} onClick={onClick}>
      <span className="ctx-check">{checked ? "✓" : ""}</span>
      {label}
      {keys && <span className="ctx-keys">{keys}</span>}
    </button>
  );
}

export function ClipMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const project = useEditor((st) => st.project);
  const selection = useEditor((st) => st.selection);
  const playhead = useEditor((st) => st.playhead);
  const busy = useEditor((st) => !!st.busy);
  const hasClipboard = useEditor((st) => st.clipboard.length > 0);
  const [pos, setPos] = useState({ x, y, flip: false });

  // 화면 밖으로 나가지 않게 위치를 맞춘다 (속도 하위 메뉴가 오른쪽에 들어갈 자리가 없으면 왼쪽으로)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)), flip: x + r.width * 2 > innerWidth });
  }, [x, y]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const clips = selection.map((id) => findClip(project, id)?.clip).filter(Boolean) as Clip[];
  if (!clips.length) return null;
  const hasAudio = (c: Clip) => c.kind === "audio" || (c.kind === "video" && !!project.media.find((m) => m.id === c.mediaId)?.hasAudio);
  const inside = (c: Clip) => playhead > c.start && playhead < clipEnd(c);
  const av = clips.filter((c) => c.kind === "video" || c.kind === "audio");
  const sound = av.filter(hasAudio);
  const videos = clips.filter((c) => c.kind === "video");
  const allMuted = sound.length > 0 && sound.every((c) => c.muted);
  const speed = av[0]?.speed;
  const run = (fn: () => unknown) => () => {
    onClose();
    fn();
  };

  return (
    <div className="ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <Item label="분할" keys="Ctrl+B" disabled={!clips.some(inside)} title="재생헤드 위치에서 나눕니다" onClick={run(() => s().splitAtPlayhead())} />
      <Item label="복사" keys="Ctrl+C" onClick={run(() => s().copy())} />
      <Item label="붙여넣기" keys="Ctrl+V" disabled={!hasClipboard} title="재생헤드 위치에 붙여 넣습니다" onClick={run(() => s().paste())} />
      <Item label="삭제" keys="Delete" onClick={run(() => s().deleteSelected())} />
      {av.length > 0 && (
        <>
          <div className="ctx-sep" />
          {sound.length > 0 && (
            <Item
              label="오디오 분리"
              disabled={!videos.some((c) => !c.muted && hasAudio(c))}
              title="영상의 소리를 오디오 트랙으로 떼어 내고 원래 클립은 음소거합니다"
              onClick={run(() => s().detachSelectedAudio())}
            />
          )}
          {sound.length > 0 && (
            <Item label={allMuted ? "음소거 해제" : "음소거"} onClick={run(() => s().commit((p) => sound.reduce((acc, c) => mapClip(acc, c.id, (x) => ({ ...x, muted: !allMuted })), p)))} />
          )}
          <div className="ctx-item ctx-parent">
            <span className="ctx-check" />
            속도
            <span className="ctx-keys">
              {speed !== undefined && `${+speed.toFixed(2)}x`} <ChevronRight size={12} />
            </span>
            <div className={`ctx-menu ctx-sub ${pos.flip ? "flip" : ""}`}>
              {SPEEDS.map((v) => (
                <Item key={v} label={`${v}x`} checked={speed !== undefined && Math.abs(speed - v) < 1e-3} onClick={run(() => s().changeSpeed(av.map((c) => c.id), v))} />
              ))}
            </div>
          </div>
        </>
      )}
      {videos.length > 0 && (
        <>
          <div className="ctx-sep" />
          <Item label="정지 화면" disabled={busy || !inside(videos[0])} title="재생헤드 위치의 프레임을 3초 정지 화면으로 끼워 넣습니다" onClick={run(freezeFrame)} />
          <Item label="역재생" disabled={busy || videos.length !== 1} title={videos.length !== 1 ? "영상 클립 하나만 선택하세요" : undefined} onClick={run(() => reverseClip(videos[0].id))} />
        </>
      )}
      {sound.some((c) => !c.muted) && (
        <>
          <div className="ctx-sep" />
          <Item label="자동 캡션" disabled={busy} title="선택한 클립의 말소리를 받아 적어 자막으로 만듭니다 (언어·모델은 자막 패널에서 마지막으로 고른 값)" onClick={run(() => autoCaption(loadCaptionPrefs()))} />
        </>
      )}
    </div>
  );
}
