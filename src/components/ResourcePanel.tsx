import { Film, FolderOpen, Image as ImageIcon, Music, Plus, Sliders, Sparkles, Sticker, Trash2, Type, Wand2, Shuffle } from "lucide-react";
import { useState } from "react";
import { findClip } from "../core/timeline";
import { DEFAULT_ADJUST, type Adjust, type MediaItem, type TextStyle } from "../core/types";
import { mediaUrl, useEditor, type ResourceTab } from "../editor/store";
import { shortTime } from "./format";
import { MEDIA_DND } from "./Timeline";

const TABS: { id: ResourceTab; label: string; icon: React.ReactNode }[] = [
  { id: "media", label: "미디어", icon: <Film size={18} /> },
  { id: "audio", label: "오디오", icon: <Music size={18} /> },
  { id: "text", label: "텍스트", icon: <Type size={18} /> },
  { id: "sticker", label: "스티커", icon: <Sticker size={18} /> },
  { id: "effect", label: "효과", icon: <Sparkles size={18} /> },
  { id: "transition", label: "전환", icon: <Shuffle size={18} /> },
  { id: "filter", label: "필터", icon: <Wand2 size={18} /> },
  { id: "adjust", label: "조정", icon: <Sliders size={18} /> },
];

// ZapCut 자체 텍스트 스타일 프리셋
const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: "기본", style: {} },
  { name: "굵은 외곽선", style: { color: "#ffe14d", strokeColor: "#000000", strokeWidth: 10, fontSize: 110 } },
  { name: "자막 바", style: { color: "#ffffff", strokeWidth: 0, background: "rgba(0,0,0,0.6)", fontSize: 64, bold: false } },
  { name: "네온 핑크", style: { color: "#ff5cd6", strokeColor: "#2a0030", strokeWidth: 8 } },
  { name: "민트 타이틀", style: { color: "#3ff2c4", strokeColor: "#003a2e", strokeWidth: 6, fontSize: 130 } },
  { name: "손글씨 느낌", style: { fontFamily: "Gungsuh", italic: true, strokeWidth: 0, fontSize: 100 } },
];

// ZapCut 자체 필터 프리셋 (밝기/대비/채도 조합)
const FILTERS: { name: string; adjust: Adjust; swatch: string }[] = [
  { name: "원본", adjust: { ...DEFAULT_ADJUST, brightness: 0, contrast: 0, saturation: 0 }, swatch: "linear-gradient(135deg,#5a7,#58c)" },
  { name: "비비드", adjust: { ...DEFAULT_ADJUST, brightness: 0.03, contrast: 0.15, saturation: 0.45 }, swatch: "linear-gradient(135deg,#0d8,#38f)" },
  { name: "소프트", adjust: { ...DEFAULT_ADJUST, brightness: 0.08, contrast: -0.15, saturation: -0.1 }, swatch: "linear-gradient(135deg,#bcd,#dcb)" },
  { name: "시네마", adjust: { ...DEFAULT_ADJUST, brightness: -0.05, contrast: 0.25, saturation: -0.25 }, swatch: "linear-gradient(135deg,#345,#876)" },
  { name: "흑백", adjust: { ...DEFAULT_ADJUST, brightness: 0, contrast: 0.1, saturation: -1 }, swatch: "linear-gradient(135deg,#222,#ddd)" },
  { name: "빈티지", adjust: { ...DEFAULT_ADJUST, brightness: 0.05, contrast: -0.1, saturation: -0.45 }, swatch: "linear-gradient(135deg,#a98,#cb9)" },
  { name: "밝게", adjust: { ...DEFAULT_ADJUST, brightness: 0.18, contrast: 0, saturation: 0.05 }, swatch: "linear-gradient(135deg,#fff,#cdf)" },
  { name: "드라마틱", adjust: { ...DEFAULT_ADJUST, brightness: -0.08, contrast: 0.4, saturation: 0.1 }, swatch: "linear-gradient(135deg,#111,#a52)" },
];

const SOON: Partial<Record<ResourceTab, string>> = {
  sticker: "ZapCut 자체 제작 스티커 라이브러리는 2단계에서 제공됩니다. 지금은 PNG 이미지를 미디어로 가져와 오버레이 트랙에 놓으면 스티커처럼 쓸 수 있습니다.",
  effect: "비디오 효과(흔들림, 글리치, 블러, 비네트 등)는 2단계에서 제공됩니다.",
  transition: "전환 효과(디졸브, 페이드, 슬라이드, 와이프, 줌)는 2단계에서 제공됩니다.",
  adjust: "조정 레이어는 2단계에서 제공됩니다. 지금은 클립을 선택하고 오른쪽 속성 패널의 '조정' 탭을 사용하세요.",
};

function MediaCard({ m }: { m: MediaItem }) {
  const add = useEditor((s) => s.addMediaToTimeline);
  const remove = useEditor((s) => s.removeMedia);
  const used = useEditor((s) => s.project.tracks.some((t) => t.clips.some((c) => c.mediaId === m.id)));
  return (
    <div className="media-card" draggable onDragStart={(e) => e.dataTransfer.setData(MEDIA_DND, m.id)} onDoubleClick={() => add(m.id)} title={`${m.name}\n${m.width ? `${m.width}×${m.height} · ` : ""}${m.codec ?? ""}`}>
      <div className="media-thumb" style={m.thumbnail ? { backgroundImage: `url("${mediaUrl(m.thumbnail)}")` } : undefined}>
        {!m.thumbnail && (m.kind === "audio" ? <Music size={28} /> : <ImageIcon size={28} />)}
        {m.kind !== "image" && <span className="media-dur">{shortTime(m.duration)}</span>}
        {used && <span className="media-used">사용됨</span>}
        <button className="media-add" title="타임라인에 추가" onClick={() => add(m.id)}>
          <Plus size={16} />
        </button>
        <button className="media-del" title="미디어 제거" onClick={() => remove(m.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="media-name">{m.name}</div>
    </div>
  );
}

export function ResourcePanel() {
  const tab = useEditor((s) => s.resourceTab);
  const setTab = useEditor((s) => s.setTab);
  const media = useEditor((s) => s.project.media);
  const importing = useEditor((s) => s.importing);
  const [dragOver, setDragOver] = useState(false);

  const importDialog = async () => {
    const paths = await window.zapcut.pickMedia();
    if (paths.length) await useEditor.getState().importFiles(paths);
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const paths = [...e.dataTransfer.files].map((f) => window.zapcut.pathForFile(f)).filter(Boolean);
    if (paths.length) await useEditor.getState().importFiles(paths);
  };
  const applyFilter = (adjust: Adjust) => {
    const s = useEditor.getState();
    const targets = s.selection.filter((id) => {
      const k = findClip(s.project, id)?.clip.kind;
      return k === "video" || k === "image";
    });
    if (!targets.length) return s.notify("필터를 적용할 비디오/이미지 클립을 먼저 선택하세요");
    s.commit((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (targets.includes(c.id) ? { ...c, adjust: { ...adjust } } : c)) })) }));
  };

  const list = tab === "audio" ? media.filter((m) => m.kind === "audio") : media;

  return (
    <div className="resource-panel">
      <div className="resource-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`resource-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="resource-body" onDragOver={(e) => (e.preventDefault(), setDragOver(true))} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
        {(tab === "media" || tab === "audio") && (
          <>
            <div className="resource-head">
              <button className="primary-btn" onClick={importDialog}>
                <FolderOpen size={15} /> 가져오기
              </button>
              {importing > 0 && <span className="muted">불러오는 중… ({importing})</span>}
            </div>
            {list.length === 0 ? (
              <div className={`drop-zone ${dragOver ? "over" : ""}`} onClick={importDialog}>
                <FolderOpen size={32} />
                <p>{tab === "audio" ? "음악·효과음 파일을" : "동영상·사진·오디오 파일을"} 여기에 끌어 놓거나 클릭해서 가져오세요</p>
              </div>
            ) : (
              <div className={`media-grid ${dragOver ? "over" : ""}`}>
                {list.map((m) => (
                  <MediaCard key={m.id} m={m} />
                ))}
              </div>
            )}
          </>
        )}
        {tab === "text" && (
          <>
            <div className="resource-head">
              <button className="primary-btn" onClick={() => useEditor.getState().addText()}>
                <Plus size={15} /> 기본 텍스트 추가
              </button>
            </div>
            <div className="section-label">텍스트 스타일</div>
            <div className="preset-grid">
              {TEXT_PRESETS.map((p) => (
                <button key={p.name} className="text-preset" onClick={() => useEditor.getState().addText(p.name === "기본" ? undefined : p.name, p.style)}>
                  <span
                    style={{
                      color: p.style.color ?? "#fff",
                      WebkitTextStroke: p.style.strokeWidth ? `1.5px ${p.style.strokeColor}` : undefined,
                      background: p.style.background || undefined,
                      fontStyle: p.style.italic ? "italic" : undefined,
                      fontFamily: p.style.fontFamily,
                    }}
                  >
                    가나다 Aa
                  </span>
                  <small>{p.name}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {tab === "filter" && (
          <>
            <div className="section-label">필터 — 클립을 선택한 뒤 누르세요</div>
            <div className="preset-grid">
              {FILTERS.map((f) => (
                <button key={f.name} className="filter-preset" onClick={() => applyFilter(f.adjust)}>
                  <span className="swatch" style={{ background: f.swatch }} />
                  <small>{f.name}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {SOON[tab] && (
          <div className="soon">
            <Sparkles size={28} />
            <p>{SOON[tab]}</p>
          </div>
        )}
      </div>
    </div>
  );
}
