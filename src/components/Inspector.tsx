import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { findClip, mapClip, MIN_CLIP, setSpeed } from "../core/timeline";
import { DEFAULT_ADJUST, DEFAULT_TRANSFORM, type Clip, type TextStyle } from "../core/types";
import { useEditor } from "../editor/store";

type Edit = (fn: (c: Clip) => Clip, transient?: boolean) => void;

function Slider({ label, value, min, max, step, unit = "", format, onChange, onReset }: { label: string; value: number; min: number; max: number; step: number; unit?: string; format?: (v: number) => string; onChange: (v: number, transient: boolean) => void; onReset?: () => void }) {
  const s = useEditor.getState;
  return (
    <div className="field">
      <label onDoubleClick={onReset} title={onReset ? "더블클릭하면 초기화" : undefined}>
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => s().beginGesture()}
        onPointerUp={() => s().endGesture()}
        onChange={(e) => onChange(+e.target.value, !!s().gestureBase)}
      />
      <input
        className="num"
        type="number"
        step={step}
        value={format ? format(value) : +value.toFixed(2)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)), false);
        }}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

function TransformSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const t = clip.transform;
  const set = (patch: Partial<typeof t>, tr: boolean) => edit((c) => ({ ...c, transform: { ...c.transform, ...patch } }), tr);
  return (
    <section>
      <h4>
        변형
        <button className="mini" title="초기화" onClick={() => edit((c) => ({ ...c, transform: { ...DEFAULT_TRANSFORM, ...(c.kind === "text" ? { y: c.transform.y } : {}) } }))}>
          <RotateCcw size={13} />
        </button>
      </h4>
      <Slider label="크기" value={t.scale * 100} min={5} max={500} step={1} unit="%" onChange={(v, tr) => set({ scale: v / 100 }, tr)} onReset={() => set({ scale: 1 }, false)} />
      <Slider label="위치 X" value={t.x * 100} min={-100} max={100} step={0.5} unit="%" onChange={(v, tr) => set({ x: v / 100 }, tr)} onReset={() => set({ x: 0 }, false)} />
      <Slider label="위치 Y" value={t.y * 100} min={-100} max={100} step={0.5} unit="%" onChange={(v, tr) => set({ y: v / 100 }, tr)} onReset={() => set({ y: 0 }, false)} />
      <Slider label="회전" value={t.rotation} min={-180} max={180} step={1} unit="°" onChange={(v, tr) => set({ rotation: v }, tr)} onReset={() => set({ rotation: 0 }, false)} />
      <Slider label="불투명도" value={t.opacity * 100} min={0} max={100} step={1} unit="%" onChange={(v, tr) => set({ opacity: v / 100 }, tr)} onReset={() => set({ opacity: 1 }, false)} />
    </section>
  );
}

function AdjustSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const a = clip.adjust;
  const set = (patch: Partial<typeof a>, tr: boolean) => edit((c) => ({ ...c, adjust: { ...c.adjust, ...patch } }), tr);
  return (
    <section>
      <h4>
        기본 조정
        <button className="mini" title="초기화" onClick={() => edit((c) => ({ ...c, adjust: { ...DEFAULT_ADJUST } }))}>
          <RotateCcw size={13} />
        </button>
      </h4>
      <Slider label="밝기" value={a.brightness * 100} min={-100} max={100} step={1} onChange={(v, tr) => set({ brightness: v / 100 }, tr)} onReset={() => set({ brightness: 0 }, false)} />
      <Slider label="대비" value={a.contrast * 100} min={-100} max={100} step={1} onChange={(v, tr) => set({ contrast: v / 100 }, tr)} onReset={() => set({ contrast: 0 }, false)} />
      <Slider label="채도" value={a.saturation * 100} min={-100} max={100} step={1} onChange={(v, tr) => set({ saturation: v / 100 }, tr)} onReset={() => set({ saturation: 0 }, false)} />
    </section>
  );
}

function AudioSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  return (
    <section>
      <h4>오디오</h4>
      <Slider label="볼륨" value={clip.volume * 100} min={0} max={200} step={1} unit="%" onChange={(v, tr) => edit((c) => ({ ...c, volume: v / 100 }), tr)} onReset={() => edit((c) => ({ ...c, volume: 1 }))} />
      <Slider label="페이드 인" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration / 2)} step={0.1} unit="초" onChange={(v, tr) => edit((c) => ({ ...c, fadeIn: v }), tr)} />
      <Slider label="페이드 아웃" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration / 2)} step={0.1} unit="초" onChange={(v, tr) => edit((c) => ({ ...c, fadeOut: v }), tr)} />
      <label className="check">
        <input type="checkbox" checked={clip.muted} onChange={(e) => edit((c) => ({ ...c, muted: e.target.checked }))} /> 이 클립 음소거
      </label>
    </section>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  const s = useEditor.getState;
  const presets = [0.25, 0.5, 1, 1.5, 2, 4];
  const apply = (v: number, transient: boolean) => {
    if (transient) s().updateGesture((p) => setSpeed(p, clip.id, v));
    else s().changeSpeed(clip.id, v);
  };
  const srcLen = clip.duration * clip.speed;
  return (
    <section>
      <h4>배속</h4>
      <Slider label="속도" value={clip.speed} min={0.1} max={10} step={0.05} unit="x" onChange={apply} onReset={() => apply(1, false)} />
      <div className="chips">
        {presets.map((v) => (
          <button key={v} className={`chip ${Math.abs(clip.speed - v) < 1e-3 ? "on" : ""}`} onClick={() => apply(v, false)}>
            {v}x
          </button>
        ))}
      </div>
      <p className="muted small">
        원본 {srcLen.toFixed(1)}초 → 타임라인 {clip.duration.toFixed(1)}초. 오디오 음높이는 유지됩니다.
      </p>
    </section>
  );
}

const FONTS = ["Malgun Gothic", "Gulim", "Dotum", "Batang", "Gungsuh", "Arial", "Segoe UI", "Impact", "Georgia", "Consolas"];

function TextSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const t = clip.text!;
  const set = (patch: Partial<TextStyle>, tr = false) => edit((c) => ({ ...c, text: { ...c.text!, ...patch } }), tr);
  return (
    <section>
      <h4>텍스트</h4>
      <textarea className="text-input" rows={3} value={t.content} onChange={(e) => set({ content: e.target.value })} />
      <div className="field">
        <label>글꼴</label>
        <select value={t.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <Slider label="글자 크기" value={t.fontSize} min={12} max={400} step={1} onChange={(v, tr) => set({ fontSize: v }, tr)} />
      <div className="field">
        <label>스타일</label>
        <div className="chips">
          <button className={`chip ${t.bold ? "on" : ""}`} onClick={() => set({ bold: !t.bold })}>
            <b>굵게</b>
          </button>
          <button className={`chip ${t.italic ? "on" : ""}`} onClick={() => set({ italic: !t.italic })}>
            <i>기울임</i>
          </button>
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={`chip ${t.align === a ? "on" : ""}`} onClick={() => set({ align: a })}>
              {{ left: "왼쪽", center: "가운데", right: "오른쪽" }[a]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>글자 색</label>
        <input type="color" value={t.color} onChange={(e) => set({ color: e.target.value })} />
      </div>
      <div className="field">
        <label>외곽선 색</label>
        <input type="color" value={t.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} />
      </div>
      <Slider label="외곽선 두께" value={t.strokeWidth} min={0} max={30} step={1} onChange={(v, tr) => set({ strokeWidth: v }, tr)} />
      <div className="field">
        <label>배경</label>
        <label className="check">
          <input type="checkbox" checked={!!t.background} onChange={(e) => set({ background: e.target.checked ? "#000000" : "" })} /> 사용
        </label>
        {t.background && <input type="color" value={t.background.startsWith("#") ? t.background : "#000000"} onChange={(e) => set({ background: e.target.value })} />}
      </div>
    </section>
  );
}

function ProjectSection() {
  const p = useEditor((s) => s.project);
  const set = useEditor((s) => s.setProjectProps);
  return (
    <div className="inspector-body">
      <section>
        <h4>프로젝트</h4>
        <div className="field">
          <label>이름</label>
          <input className="text" value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>해상도</label>
          <span className="value">
            {p.width} × {p.height}
          </span>
        </div>
        <div className="field">
          <label>프레임 속도</label>
          <select value={p.fps} onChange={(e) => set({ fps: +e.target.value })}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>배경색</label>
          <input type="color" value={p.background} onChange={(e) => set({ background: e.target.value })} />
        </div>
      </section>
      <p className="muted small pad">타임라인에서 클립을 선택하면 속성을 편집할 수 있습니다.</p>
    </div>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const [tab, setTab] = useState("main");
  const found = selection.length === 1 ? findClip(project, selection[0]) : undefined;
  if (!found) {
    return (
      <div className="inspector">
        <div className="panel-title">{selection.length > 1 ? `${selection.length}개 클립 선택됨` : "속성"}</div>
        <ProjectSection />
      </div>
    );
  }
  const { clip } = found;
  const media = project.media.find((m) => m.id === clip.mediaId);
  const edit: Edit = (fn, transient) => {
    const s = useEditor.getState();
    if (transient) s.updateGesture((p) => mapClip(p, clip.id, fn));
    else s.updateClip(clip.id, fn);
  };
  const tabs: { id: string; label: string }[] =
    clip.kind === "text"
      ? [{ id: "main", label: "텍스트" }, { id: "transform", label: "화면" }]
      : clip.kind === "audio"
        ? [{ id: "main", label: "오디오" }, { id: "speed", label: "속도" }]
        : clip.kind === "image"
          ? [{ id: "main", label: "화면" }, { id: "adjust", label: "조정" }]
          : [{ id: "main", label: "화면" }, ...(media?.hasAudio ? [{ id: "audio", label: "오디오" }] : []), { id: "speed", label: "속도" }, { id: "adjust", label: "조정" }];
  const active = tabs.some((t) => t.id === tab) ? tab : "main";
  return (
    <div className="inspector">
      <div className="inspector-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={active === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {active === "main" && clip.kind === "text" && <TextSection clip={clip} edit={edit} />}
        {active === "main" && clip.kind === "audio" && <AudioSection clip={clip} edit={edit} />}
        {active === "main" && (clip.kind === "video" || clip.kind === "image") && <TransformSection clip={clip} edit={edit} />}
        {active === "main" && clip.kind === "image" && (
          <section>
            <h4>길이</h4>
            <Slider label="표시 시간" value={clip.duration} min={MIN_CLIP} max={60} step={0.1} unit="초" onChange={(v, tr) => edit((c) => ({ ...c, duration: v }), tr)} />
          </section>
        )}
        {active === "transform" && <TransformSection clip={clip} edit={edit} />}
        {active === "audio" && <AudioSection clip={clip} edit={edit} />}
        {active === "speed" && <SpeedSection clip={clip} />}
        {active === "adjust" && <AdjustSection clip={clip} edit={edit} />}
      </div>
    </div>
  );
}
