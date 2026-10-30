import { Diamond, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Rewind, Snowflake, X } from "lucide-react";
import { useEffect, useState } from "react";
import { findFilter } from "../core/color";
import { defaultParams, findEffect } from "../core/effects";
import { IN_ANIMS, LOOP_ANIMS, OUT_ANIMS, findAnim } from "../core/motion";
import { canvasSize, findClip, mapClip, MIN_CLIP, setSpeed, tierLabel, TIERS } from "../core/timeline";
import { findTransition, TRANSITIONS } from "../core/transitions";
import { DEFAULT_ADJUST, DEFAULT_CANVAS, DEFAULT_CHROMA, DEFAULT_CROP, DEFAULT_MASK, DEFAULT_TRANSFORM, type Adjust, type BlendMode, type Clip, type KfProp, type MaskType, type TextStyle } from "../core/types";
import { freezeFrame, importLut, reverseClip } from "../editor/actions";
import { useEditor } from "../editor/store";

type Edit = (fn: (c: Clip) => Clip, transient?: boolean) => void;

interface KfInfo {
  has: boolean;
  at: boolean;
  onToggle: () => void;
}

function Slider({ label, value, min, max, step, unit = "", onChange, onReset, kf }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number, transient: boolean) => void; onReset?: () => void; kf?: KfInfo }) {
  const s = useEditor.getState;
  return (
    <div className="field">
      <label onDoubleClick={onReset} title={onReset ? "더블클릭하면 초기화" : undefined}>
        {kf && (
          <button className={`kf-btn ${kf.at ? "at" : kf.has ? "has" : ""}`} title={kf.at ? "이 시점 키프레임 삭제" : "이 시점에 키프레임 추가"} onClick={kf.onToggle}>
            <Diamond size={10} />
          </button>
        )}
        {label}
      </label>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={() => s().beginGesture()} onPointerUp={() => s().endGesture()} onChange={(e) => onChange(+e.target.value, !!s().gestureBase)} />
      <input
        className="num"
        type="number"
        step={step}
        value={+value.toFixed(2)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)), false);
        }}
      />
      <span className="unit">{unit}</span>
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 키프레임 가능한 속성 슬라이더 */
function PropSlider({ clip, prop, label, min, max, step, unit, k = 1 }: { clip: Clip; prop: KfProp; label: string; min: number; max: number; step: number; unit: string; k?: number }) {
  const s = useEditor.getState;
  const playhead = useEditor((st) => st.playhead);
  const T = playhead - clip.start;
  const keys = clip.keyframes?.[prop] ?? [];
  const value = s().valueAt(clip, prop, Math.min(Math.max(0, T), clip.duration)) * k;
  const def = prop === "scale" || prop === "opacity" || prop === "volume" ? 1 : 0;
  return (
    <Slider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v, tr) => s().setClipProps(clip.id, { [prop]: v / k }, tr)}
      onReset={() => s().setClipProps(clip.id, { [prop]: def })}
      kf={{ has: keys.length > 0, at: keys.some((kk) => Math.abs(kk.t - T) < 0.02), onToggle: () => s().toggleKeyframe(clip.id, prop) }}
    />
  );
}

function TransformSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const hasKf = Object.values(clip.keyframes ?? {}).some((k) => k && k.length);
  return (
    <section>
      <h4>
        변형
        <span>
          {hasKf && (
            <button className="mini" title="모든 위치/크기/회전/불투명도 키프레임 지우기" onClick={() => (["x", "y", "scale", "rotation", "opacity"] as KfProp[]).forEach((p) => clip.keyframes?.[p]?.length && useEditor.getState().clearKeyframes(clip.id, p))}>
              <X size={13} />
            </button>
          )}
          <button className="mini" title="변형 초기화" onClick={() => edit((c) => ({ ...c, transform: { ...DEFAULT_TRANSFORM, ...(c.kind === "text" ? { y: c.transform.y } : {}) }, keyframes: c.keyframes?.volume ? { volume: c.keyframes.volume } : undefined }))}>
            <RotateCcw size={13} />
          </button>
        </span>
      </h4>
      <PropSlider clip={clip} prop="scale" label="크기" min={5} max={500} step={1} unit="%" k={100} />
      <PropSlider clip={clip} prop="x" label="위치 X" min={-100} max={100} step={0.5} unit="%" k={100} />
      <PropSlider clip={clip} prop="y" label="위치 Y" min={-100} max={100} step={0.5} unit="%" k={100} />
      <PropSlider clip={clip} prop="rotation" label="회전" min={-360} max={360} step={1} unit="°" />
      <PropSlider clip={clip} prop="opacity" label="불투명도" min={0} max={100} step={1} unit="%" k={100} />
      {clip.kind !== "text" && (
        <div className="chips pad-top">
          <button className={`chip ${clip.flipH ? "on" : ""}`} onClick={() => edit((c) => ({ ...c, flipH: !c.flipH }))}>
            <FlipHorizontal2 size={13} /> 좌우 반전
          </button>
          <button className={`chip ${clip.flipV ? "on" : ""}`} onClick={() => edit((c) => ({ ...c, flipV: !c.flipV }))}>
            <FlipVertical2 size={13} /> 상하 반전
          </button>
          <button className="chip" onClick={() => useEditor.getState().setClipProps(clip.id, { rotation: (useEditor.getState().valueAt(clip, "rotation", Math.max(0, useEditor.getState().playhead - clip.start)) + 90) % 360 })}>
            <RotateCw size={13} /> 90° 회전
          </button>
        </div>
      )}
      <p className="muted small">◆ 를 눌러 키프레임을 추가하면 그 속성은 시간에 따라 변합니다.</p>
    </section>
  );
}

function CropBlendSection({ clip, edit, main }: { clip: Clip; edit: Edit; main: boolean }) {
  const cr = clip.crop ?? DEFAULT_CROP;
  const setCrop = (patch: Partial<typeof cr>, tr: boolean) => edit((c) => ({ ...c, crop: { ...(c.crop ?? DEFAULT_CROP), ...patch } }), tr);
  const cv = clip.canvas ?? DEFAULT_CANVAS;
  const blends: { value: BlendMode; label: string }[] = [
    { value: "normal", label: "일반" }, { value: "multiply", label: "곱하기" }, { value: "screen", label: "스크린" }, { value: "overlay", label: "오버레이" },
    { value: "darken", label: "어둡게" }, { value: "lighten", label: "밝게" }, { value: "addition", label: "더하기" }, { value: "difference", label: "차이" }, { value: "exclusion", label: "제외" },
  ];
  return (
    <>
      <section>
        <h4>
          자르기
          <button className="mini" title="초기화" onClick={() => edit((c) => ({ ...c, crop: undefined }))}>
            <RotateCcw size={13} />
          </button>
        </h4>
        <Slider label="왼쪽" value={cr.l * 100} min={0} max={45} step={0.5} unit="%" onChange={(v, tr) => setCrop({ l: v / 100 }, tr)} />
        <Slider label="오른쪽" value={cr.r * 100} min={0} max={45} step={0.5} unit="%" onChange={(v, tr) => setCrop({ r: v / 100 }, tr)} />
        <Slider label="위" value={cr.t * 100} min={0} max={45} step={0.5} unit="%" onChange={(v, tr) => setCrop({ t: v / 100 }, tr)} />
        <Slider label="아래" value={cr.b * 100} min={0} max={45} step={0.5} unit="%" onChange={(v, tr) => setCrop({ b: v / 100 }, tr)} />
      </section>
      {main ? (
        <section>
          <h4>캔버스 배경</h4>
          <Select label="종류" value={cv.type} options={[{ value: "none", label: "없음 (프로젝트 배경)" }, { value: "color", label: "단색" }, { value: "blur", label: "흐린 배경" }]} onChange={(v) => edit((c) => ({ ...c, canvas: { ...(c.canvas ?? DEFAULT_CANVAS), type: v } }))} />
          {cv.type === "color" && (
            <div className="field">
              <label>색</label>
              <input type="color" value={cv.color} onChange={(e) => edit((c) => ({ ...c, canvas: { ...(c.canvas ?? DEFAULT_CANVAS), color: e.target.value } }))} />
            </div>
          )}
          {cv.type === "blur" && <Slider label="흐림" value={cv.blur * 100} min={5} max={100} step={1} onChange={(v, tr) => edit((c) => ({ ...c, canvas: { ...(c.canvas ?? DEFAULT_CANVAS), blur: v / 100 } }), tr)} />}
          <button className="link tiny" onClick={() => {
            const s = useEditor.getState();
            s.commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.main ? { ...t, clips: t.clips.map((c) => ({ ...c, canvas: clip.canvas })) } : t)) }));
          }}>
            메인 트랙 전체에 적용
          </button>
        </section>
      ) : (
        <section>
          <h4>혼합</h4>
          <Select label="블렌드" value={clip.blend ?? "normal"} options={blends} onChange={(v) => edit((c) => ({ ...c, blend: v }))} />
        </section>
      )}
    </>
  );
}

function TransitionSection({ clip, edit, main }: { clip: Clip; edit: Edit; main: boolean }) {
  const tr = clip.transition;
  return (
    <section>
      <h4>다음 클립으로의 전환</h4>
      {!main && (clip.blend ?? "normal") !== "normal" && <p className="muted small">블렌드 모드를 쓰는 오버레이 클립에는 전환이 적용되지 않습니다.</p>}
      <Select label="전환" value={tr?.id ?? ""} options={[{ value: "", label: "없음" }, ...TRANSITIONS.map((t) => ({ value: t.id, label: `${t.category} · ${t.name}` }))]} onChange={(v) => edit((c) => ({ ...c, transition: v ? { id: v, duration: c.transition?.duration ?? 0.6 } : undefined }))} />
      {tr && findTransition(tr.id) && <Slider label="길이" value={tr.duration} min={0.1} max={Math.max(0.2, Math.min(3, clip.duration * 0.9))} step={0.05} unit="초" onChange={(v, t) => edit((c) => ({ ...c, transition: { ...c.transition!, duration: v } }), t)} />}
    </section>
  );
}

function AnimSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const [kind, setKind] = useState<"in" | "out" | "loop">("in");
  const list = (kind === "in" ? IN_ANIMS : kind === "out" ? OUT_ANIMS : LOOP_ANIMS).filter((a) => !a.textOnly || clip.kind === "text");
  const key = kind === "in" ? "animIn" : kind === "out" ? "animOut" : "animLoop";
  const cur = clip[key];
  const curDef = findAnim(kind, cur?.id);
  return (
    <section>
      <div className="sub-tabs">
        {(["in", "out", "loop"] as const).map((k) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {{ in: "등장", out: "퇴장", loop: "반복" }[k]}
            {clip[k === "in" ? "animIn" : k === "out" ? "animOut" : "animLoop"] && " •"}
          </button>
        ))}
      </div>
      <div className="anim-grid">
        <button className={`anim-cell ${!cur ? "on" : ""}`} onClick={() => edit((c) => ({ ...c, [key]: undefined }))}>
          없음
        </button>
        {list.map((a) => (
          <button key={a.id} className={`anim-cell ${cur?.id === a.id ? "on" : ""}`} onClick={() => edit((c) => ({ ...c, [key]: { id: a.id, duration: c[key]?.duration ?? a.defaultDuration } }))}>
            {a.name}
          </button>
        ))}
      </div>
      {cur && curDef && (
        <Slider
          label={kind === "loop" ? "주기" : "길이"}
          value={cur.duration}
          min={0.1}
          max={kind === "loop" ? 6 : Math.max(0.2, clip.duration)}
          step={0.05}
          unit="초"
          onChange={(v, tr) => edit((c) => ({ ...c, [key]: { ...c[key]!, duration: v } }), tr)}
        />
      )}
    </section>
  );
}

function MaskSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const m = clip.mask ?? DEFAULT_MASK;
  const set = (patch: Partial<typeof m>, tr = false) => edit((c) => ({ ...c, mask: { ...(c.mask ?? DEFAULT_MASK), ...patch } }), tr);
  const types: { value: MaskType; label: string }[] = [
    { value: "none", label: "없음" }, { value: "linear", label: "선형" }, { value: "mirror", label: "거울(띠)" }, { value: "circle", label: "원" }, { value: "rect", label: "사각형" },
  ];
  return (
    <section>
      <h4>마스크</h4>
      <div className="chips">
        {types.map((t) => (
          <button key={t.value} className={`chip ${m.type === t.value ? "on" : ""}`} onClick={() => set({ type: t.value })}>
            {t.label}
          </button>
        ))}
      </div>
      {m.type !== "none" && (
        <>
          <Slider label="위치 X" value={m.x * 100} min={-50} max={50} step={0.5} unit="%" onChange={(v, tr) => set({ x: v / 100 }, tr)} />
          <Slider label="위치 Y" value={m.y * 100} min={-50} max={50} step={0.5} unit="%" onChange={(v, tr) => set({ y: v / 100 }, tr)} />
          {(m.type === "circle" || m.type === "rect") && <Slider label="너비" value={m.w * 100} min={2} max={200} step={1} unit="%" onChange={(v, tr) => set({ w: v / 100 }, tr)} />}
          {m.type !== "linear" && <Slider label={m.type === "mirror" ? "띠 두께" : "높이"} value={m.h * 100} min={2} max={200} step={1} unit="%" onChange={(v, tr) => set({ h: v / 100 }, tr)} />}
          <Slider label="회전" value={m.rotation} min={-180} max={180} step={1} unit="°" onChange={(v, tr) => set({ rotation: v }, tr)} />
          <Slider label="페더" value={m.feather * 100} min={0} max={100} step={1} unit="%" onChange={(v, tr) => set({ feather: v / 100 }, tr)} />
          <label className="check">
            <input type="checkbox" checked={m.invert} onChange={(e) => set({ invert: e.target.checked })} /> 반전
          </label>
        </>
      )}
    </section>
  );
}

function ChromaSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const c = clip.chroma ?? DEFAULT_CHROMA;
  const set = (patch: Partial<typeof c>, tr = false) => edit((x) => ({ ...x, chroma: { ...(x.chroma ?? DEFAULT_CHROMA), ...patch } }), tr);
  return (
    <section>
      <h4>배경 제거 (크로마키)</h4>
      <label className="check">
        <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> 사용
      </label>
      {c.enabled && (
        <>
          <div className="field">
            <label>제거할 색</label>
            <input type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} />
            <div className="chips">
              <button className="chip" onClick={() => set({ color: "#00ff00" })}>초록</button>
              <button className="chip" onClick={() => set({ color: "#0000ff" })}>파랑</button>
            </div>
          </div>
          <Slider label="강도" value={c.similarity * 100} min={1} max={100} step={1} onChange={(v, tr) => set({ similarity: v / 100 }, tr)} />
          <Slider label="가장자리" value={c.blend * 100} min={0} max={100} step={1} onChange={(v, tr) => set({ blend: v / 100 }, tr)} />
        </>
      )}
      <p className="muted small">AI 인물 배경 제거는 4단계에서 제공됩니다.</p>
    </section>
  );
}

const ADJ: { key: keyof Adjust; label: string; min?: number }[] = [
  { key: "exposure", label: "노출" }, { key: "brightness", label: "밝기" }, { key: "contrast", label: "대비" }, { key: "saturation", label: "채도" },
  { key: "vibrance", label: "생동감" }, { key: "temperature", label: "색온도" }, { key: "tint", label: "색조" }, { key: "highlights", label: "하이라이트" },
  { key: "shadows", label: "그림자" }, { key: "hue", label: "색상" }, { key: "fade", label: "바랜 효과", min: 0 }, { key: "sharpen", label: "선명도", min: 0 }, { key: "vignette", label: "비네트", min: 0 },
];

function AdjustSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const a = { ...DEFAULT_ADJUST, ...clip.adjust };
  const set = (patch: Partial<Adjust>, tr: boolean) => edit((c) => ({ ...c, adjust: { ...DEFAULT_ADJUST, ...c.adjust, ...patch } }), tr);
  const filter = findFilter(clip.filter?.id);
  return (
    <>
      <section>
        <h4>필터</h4>
        {filter ? (
          <>
            <div className="field">
              <label>적용됨</label>
              <span className="value">
                {filter.category} · {filter.name}{" "}
                <button className="link tiny" onClick={() => edit((c) => ({ ...c, filter: undefined }))}>
                  제거
                </button>
              </span>
            </div>
            <Slider label="강도" value={(clip.filter!.intensity ?? 1) * 100} min={0} max={100} step={1} unit="%" onChange={(v, tr) => edit((c) => ({ ...c, filter: { ...c.filter!, intensity: v / 100 } }), tr)} />
          </>
        ) : (
          <p className="muted small">왼쪽 ‘필터’ 탭에서 고르세요.</p>
        )}
        <div className="field">
          <label>LUT (.cube)</label>
          <span className="value">
            {clip.lut ? clip.lut.name : "없음"}{" "}
            <button className="link tiny" onClick={() => importLut(clip.id)}>
              불러오기
            </button>
            {clip.lut && (
              <button className="link tiny" onClick={() => edit((c) => ({ ...c, lut: undefined }))}>
                제거
              </button>
            )}
          </span>
        </div>
        {clip.lut && <Slider label="LUT 강도" value={clip.lut.intensity * 100} min={0} max={100} step={1} unit="%" onChange={(v, tr) => edit((c) => ({ ...c, lut: { ...c.lut!, intensity: v / 100 } }), tr)} />}
      </section>
      <section>
        <h4>
          조정
          <button className="mini" title="초기화" onClick={() => edit((c) => ({ ...c, adjust: { ...DEFAULT_ADJUST } }))}>
            <RotateCcw size={13} />
          </button>
        </h4>
        {ADJ.map((d) => (
          <Slider key={d.key} label={d.label} value={a[d.key] * 100} min={(d.min ?? -1) * 100} max={100} step={1} onChange={(v, tr) => set({ [d.key]: v / 100 }, tr)} onReset={() => set({ [d.key]: 0 }, false)} />
        ))}
      </section>
    </>
  );
}

function AudioSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  return (
    <section>
      <h4>오디오</h4>
      <PropSlider clip={clip} prop="volume" label="볼륨" min={0} max={200} step={1} unit="%" k={100} />
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
        원본 {(clip.duration * clip.speed).toFixed(1)}초 → 타임라인 {clip.duration.toFixed(1)}초. 오디오 음높이는 유지됩니다.
      </p>
      {clip.kind === "video" && (
        <div className="chips pad-top">
          <button className="chip" onClick={() => reverseClip(clip.id)}>
            <Rewind size={13} /> 역재생
          </button>
          <button className="chip" onClick={() => freezeFrame()}>
            <Snowflake size={13} /> 정지 화면 (재생헤드)
          </button>
        </div>
      )}
    </section>
  );
}

// Windows에 설치된 글꼴 (처음 한 번 읽음). 텍스트는 화면에서 그려 내보내므로 TTF/OTF 모두 쓸 수 있다
const FALLBACK_FONTS = ["Malgun Gothic", "Gulim", "Dotum", "Batang", "Gungsuh", "Arial", "Segoe UI", "Impact", "Georgia", "Consolas"];
let installedFonts: Promise<string[]> | undefined;
function useFonts(current: string) {
  const [fonts, setFonts] = useState(FALLBACK_FONTS);
  useEffect(() => {
    installedFonts ??= window
      .queryLocalFonts()
      .then((list) => [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b)))
      .catch(() => FALLBACK_FONTS);
    installedFonts.then(setFonts);
  }, []);
  // 이 PC에 없는 글꼴을 쓴 프로젝트도 현재 값은 보여 준다
  return fonts.includes(current) ? fonts : [current, ...fonts];
}

function TextSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const t = clip.text!;
  const set = (patch: Partial<TextStyle>, tr = false) => edit((c) => ({ ...c, text: { ...c.text!, ...patch } }), tr);
  const fonts = useFonts(t.fontFamily);
  return (
    <section>
      <h4>텍스트</h4>
      <textarea className="text-input" rows={3} value={t.content} onChange={(e) => set({ content: e.target.value })} />
      <div className="field">
        <label>글꼴</label>
        <select value={t.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} style={{ fontFamily: `"${t.fontFamily}"` }}>
          {fonts.map((f) => (
            <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <Slider label="글자 크기" value={t.fontSize} min={12} max={400} step={1} onChange={(v, tr) => set({ fontSize: v }, tr)} />
      <Slider label="자간" value={t.letterSpacing ?? 0} min={-10} max={80} step={1} onChange={(v, tr) => set({ letterSpacing: v }, tr)} />
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
        <label className="check">
          <input type="checkbox" checked={!!t.color2} onChange={(e) => set({ color2: e.target.checked ? "#ff5c8a" : undefined })} /> 그라데이션
        </label>
        {t.color2 && <input type="color" value={t.color2} onChange={(e) => set({ color2: e.target.value })} />}
      </div>
      <div className="field">
        <label>외곽선</label>
        <input type="color" value={t.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} />
      </div>
      <Slider label="외곽선 두께" value={t.strokeWidth} min={0} max={30} step={1} onChange={(v, tr) => set({ strokeWidth: v }, tr)} />
      <div className="field">
        <label>그림자</label>
        <label className="check">
          <input type="checkbox" checked={!!t.shadowColor} onChange={(e) => set(e.target.checked ? { shadowColor: "rgba(0,0,0,0.6)", shadowBlur: 10, shadowX: 5, shadowY: 5 } : { shadowColor: undefined })} /> 사용
        </label>
      </div>
      {t.shadowColor && <Slider label="그림자 흐림" value={t.shadowBlur ?? 0} min={0} max={60} step={1} onChange={(v, tr) => set({ shadowBlur: v }, tr)} />}
      <div className="field">
        <label>네온</label>
        <label className="check">
          <input type="checkbox" checked={!!t.glow} onChange={(e) => set({ glow: e.target.checked ? "#ff3df2" : undefined })} /> 사용
        </label>
        {t.glow && <input type="color" value={t.glow} onChange={(e) => set({ glow: e.target.value })} />}
      </div>
      <div className="field">
        <label>배경</label>
        <label className="check">
          <input type="checkbox" checked={!!t.background} onChange={(e) => set({ background: e.target.checked ? "#000000" : "" })} /> 사용
        </label>
        {t.background && <input type="color" value={t.background.startsWith("#") ? t.background : "#000000"} onChange={(e) => set({ background: e.target.value })} />}
      </div>
      {t.background && <Slider label="배경 둥글기" value={t.bgRadius ?? 0} min={0} max={100} step={1} onChange={(v, tr) => set({ bgRadius: v }, tr)} />}
    </section>
  );
}

function EffectSection({ clip, edit }: { clip: Clip; edit: Edit }) {
  const def = findEffect(clip.effect?.id);
  if (!def) return null;
  const prm = { ...defaultParams(def), ...clip.effect!.params };
  return (
    <section>
      <h4>
        {def.category} · {def.name}
      </h4>
      {def.params.length === 0 && <p className="muted small">조절할 값이 없는 효과입니다. 타임라인에서 길이와 위치를 바꾸세요.</p>}
      {def.params.map((p) => (
        <Slider key={p.key} label={p.name} value={prm[p.key]} min={p.min} max={p.max} step={p.step} onChange={(v, tr) => edit((c) => ({ ...c, effect: { ...c.effect!, params: { ...c.effect!.params, [p.key]: v } } }), tr)} onReset={() => edit((c) => ({ ...c, effect: { ...c.effect!, params: { ...c.effect!.params, [p.key]: p.default } } }))} />
      ))}
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
        <Select
          label="해상도"
          value={String(Math.min(p.width, p.height))}
          options={[
            // 등급에 없는 크기(이전 버전에서 첫 소스에 맞춘 프로젝트 등)는 그대로 보여 준다
            ...(TIERS.includes(Math.min(p.width, p.height)) ? [] : [{ value: String(Math.min(p.width, p.height)), label: `${p.width} × ${p.height}` }]),
            ...TIERS.map((t) => {
              const c = canvasSize(p.width, p.height, t);
              return { value: String(t), label: `${tierLabel(t)} (${c.width} × ${c.height})` };
            }),
          ]}
          onChange={(v) => set(canvasSize(p.width, p.height, +v))}
        />
        <Select label="프레임 속도" value={String(p.fps)} options={[24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => set({ fps: +v })} />
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
  const { clip, track } = found;
  const media = project.media.find((m) => m.id === clip.mediaId);
  const edit: Edit = (fn, transient) => {
    const s = useEditor.getState();
    if (transient) s.updateGesture((p) => mapClip(p, clip.id, fn));
    else s.updateClip(clip.id, fn);
  };
  const isMain = !!track.main;
  const tabs: { id: string; label: string }[] =
    clip.kind === "text"
      ? [{ id: "main", label: "텍스트" }, { id: "transform", label: "화면" }, { id: "anim", label: "애니메이션" }]
      : clip.kind === "audio"
        ? [{ id: "main", label: "오디오" }, { id: "speed", label: "속도" }]
        : clip.kind === "effect"
          ? [{ id: "main", label: "효과" }]
          : clip.kind === "adjust"
            ? [{ id: "main", label: "조정" }]
            : [
                { id: "main", label: "화면" },
                { id: "anim", label: "애니메이션" },
                { id: "mask", label: "마스크" },
                { id: "adjust", label: "조정" },
                ...(clip.kind === "video" && media?.hasAudio ? [{ id: "audio", label: "오디오" }] : []),
                ...(clip.kind === "video" ? [{ id: "speed", label: "속도" }] : []),
              ];
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
        {active === "main" && clip.kind === "effect" && <EffectSection clip={clip} edit={edit} />}
        {active === "main" && clip.kind === "adjust" && <AdjustSection clip={clip} edit={edit} />}
        {active === "main" && (clip.kind === "video" || clip.kind === "image") && (
          <>
            <TransformSection clip={clip} edit={edit} />
            <TransitionSection clip={clip} edit={edit} main={isMain} />
            {clip.kind === "image" && (
              <section>
                <h4>길이</h4>
                <Slider label="표시 시간" value={clip.duration} min={MIN_CLIP} max={60} step={0.1} unit="초" onChange={(v, tr) => edit((c) => ({ ...c, duration: v }), tr)} />
              </section>
            )}
            <ChromaSection clip={clip} edit={edit} />
            <CropBlendSection clip={clip} edit={edit} main={isMain} />
          </>
        )}
        {active === "transform" && <TransformSection clip={clip} edit={edit} />}
        {active === "anim" && <AnimSection clip={clip} edit={edit} />}
        {active === "mask" && <MaskSection clip={clip} edit={edit} />}
        {active === "audio" && <AudioSection clip={clip} edit={edit} />}
        {active === "speed" && <SpeedSection clip={clip} />}
        {active === "adjust" && <AdjustSection clip={clip} edit={edit} />}
      </div>
    </div>
  );
}
