import { EyeOff, Film, ScanFace, FolderOpen, Image as ImageIcon, LayoutTemplate, Music, Plus, Shuffle, Sliders, Sparkles, Sticker, Trash2, Type, Wand2, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { FILTER_CATEGORIES, FILTER_PRESETS, presetSwatch } from "../core/color";
import { EFFECT_CATEGORIES, EFFECTS } from "../core/effects";
import { clipEnd, findClip } from "../core/timeline";
import { adjacentPairs, DEFAULT_TRANSITION_DURATION, TRANSITION_CATEGORIES, TRANSITIONS } from "../core/transitions";
import type { Clip, MediaItem } from "../core/types";
import { addSound, addSticker, applyTemplate } from "../editor/actions";
import { findFaces } from "../editor/faces";
import { mediaUrl, useEditor, type ResourceTab } from "../editor/store";
import { SOUNDS } from "../library/sounds";
import { STICKER_CATEGORIES, STICKERS } from "../library/stickers";
import { TEMPLATE_CATEGORIES, TEMPLATES } from "../library/templates";
import { TEXT_TEMPLATE_CATEGORIES, TEXT_TEMPLATES } from "../library/textTemplates";
import { TITLE_CATEGORIES, TITLE_TEMPLATES } from "../library/titleTemplates";
import { shortTime } from "./format";
import { MEDIA_DND, TRANSITION_DND } from "./Timeline";
import { TitleThumb } from "./TitleThumb";
import { TransitionThumb } from "./TransitionThumb";

// 화면 일부를 가리는 효과 (영역 마스크가 붙은 효과 클립)
const COVERS: { name: string; effect: string; params: Record<string, number> }[] = [
  { name: "모자이크", effect: "mosaic", params: { size: 0.45 } },
  { name: "블러", effect: "blur", params: { strength: 0.7 } },
  { name: "검정", effect: "cover", params: { brightness: 0 } },
];

const TABS: { id: ResourceTab; label: string; icon: React.ReactNode }[] = [
  { id: "media", label: "미디어", icon: <Film size={17} /> },
  { id: "audio", label: "오디오", icon: <Music size={17} /> },
  { id: "text", label: "텍스트", icon: <Type size={17} /> },
  { id: "sticker", label: "스티커", icon: <Sticker size={17} /> },
  { id: "effect", label: "효과", icon: <Sparkles size={17} /> },
  { id: "transition", label: "전환", icon: <Shuffle size={17} /> },
  { id: "filter", label: "필터", icon: <Wand2 size={17} /> },
  { id: "adjust", label: "조정", icon: <Sliders size={17} /> },
  { id: "template", label: "템플릿", icon: <LayoutTemplate size={17} /> },
];

function MediaCard({ m }: { m: MediaItem }) {
  const add = useEditor((s) => s.addMediaToTimeline);
  const remove = useEditor((s) => s.removeMedia);
  const used = useEditor((s) => s.project.tracks.some((t) => t.clips.some((c) => c.mediaId === m.id)));
  return (
    <div className="media-card" draggable onDragStart={(e) => e.dataTransfer.setData(MEDIA_DND, m.id)} onDoubleClick={() => add(m.id)} title={`${m.name}\n${m.width ? `${m.width}×${m.height} · ` : ""}${m.codec ?? ""}${m.proxy ? " · 프록시 사용" : ""}`}>
      <div className="media-thumb" style={m.thumbnail ? { backgroundImage: `url("${mediaUrl(m.thumbnail)}")`, backgroundSize: m.sticker ? "contain" : "cover" } : undefined}>
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

/** 카테고리 칩 + 목록 */
function Categorized<T>({ categories, items, cat, render, className = "preset-grid" }: { categories: string[]; items: T[]; cat: (t: T) => string; render: (t: T) => React.ReactNode; className?: string }) {
  const [active, setActive] = useState("전체");
  const shown = active === "전체" ? items : items.filter((t) => cat(t) === active);
  return (
    <>
      <div className="cat-chips">
        {["전체", ...categories].map((c) => (
          <button key={c} className={`chip ${active === c ? "on" : ""}`} onClick={() => setActive(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className={className}>{shown.map(render)}</div>
    </>
  );
}

/**
 * 전환을 넣을 컷(앞 클립). 선택한 클립이 있는 영상 트랙, 없으면 메인 트랙에서 고른다.
 * 선택한 클립이 컷 앞이면 그 컷, 아니면 재생헤드에 가장 가까운 컷. all이면 그 트랙의 모든 컷.
 */
function transitionTargets(all: boolean): Clip[] {
  const s = useEditor.getState();
  const track = s.project.tracks.find((t) => t.kind === "video" && t.clips.some((c) => s.selection.includes(c.id))) ?? s.project.tracks.find((t) => t.main);
  const cuts = track ? adjacentPairs(track).map(([a]) => a) : [];
  if (all || !cuts.length) return cuts;
  const sel = cuts.find((c) => s.selection.includes(c.id));
  if (sel) return [sel];
  return [cuts.reduce((best, c) => (Math.abs(clipEnd(c) - s.playhead) < Math.abs(clipEnd(best) - s.playhead) ? c : best))];
}

export function ResourcePanel() {
  const tab = useEditor((s) => s.resourceTab);
  const setTab = useEditor((s) => s.setTab);
  const media = useEditor((s) => s.project.media);
  const importing = useEditor((s) => s.importing);
  const [dragOver, setDragOver] = useState(false);
  const [audioTab, setAudioTab] = useState<"mine" | "sfx" | "bgm">("sfx");
  const [textTab, setTextTab] = useState<"template" | "title" | "basic">("template");
  const visibleMedia = useMemo(() => media.filter((m) => !m.sticker), [media]);

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
  const applyFilter = (id: string) => {
    const s = useEditor.getState();
    const targets = s.selection.filter((cid) => {
      const k = findClip(s.project, cid)?.clip.kind;
      return k === "video" || k === "image" || k === "adjust";
    });
    if (!targets.length) return s.notify("필터를 적용할 영상/사진/조정 클립을 먼저 선택하세요");
    s.commit((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (targets.includes(c.id) ? { ...c, filter: id ? { id, intensity: c.filter?.intensity ?? 1 } : undefined } : c)) })) }));
  };
  const applyTransition = (id: string, all = false) => {
    const s = useEditor.getState();
    const targets = transitionTargets(all);
    if (!targets.length) return s.notify("전환은 같은 트랙에서 붙어 있는 두 영상/사진 클립 사이에 들어갑니다");
    s.commit((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (targets.some((x) => x.id === c.id) ? { ...c, transition: { id, duration: c.transition?.duration ?? DEFAULT_TRANSITION_DURATION } } : c)) })) }));
    if (!all) s.notify(`전환 적용: ${TRANSITIONS.find((t) => t.id === id)?.name}`);
  };

  const audioList = visibleMedia.filter((m) => m.kind === "audio");

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
        {tab === "media" && (
          <>
            <div className="resource-head">
              <button className="primary-btn" onClick={importDialog}>
                <FolderOpen size={15} /> 가져오기
              </button>
              {importing > 0 && <span className="muted">불러오는 중… ({importing})</span>}
            </div>
            {visibleMedia.length === 0 ? (
              <div className={`drop-zone ${dragOver ? "over" : ""}`} onClick={importDialog}>
                <FolderOpen size={32} />
                <p>동영상·사진·오디오 파일을 여기에 끌어 놓거나 클릭해서 가져오세요</p>
              </div>
            ) : (
              <div className={`media-grid ${dragOver ? "over" : ""}`}>
                {visibleMedia.map((m) => (
                  <MediaCard key={m.id} m={m} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "audio" && (
          <>
            <div className="sub-tabs">
              {(["sfx", "bgm", "mine"] as const).map((k) => (
                <button key={k} className={audioTab === k ? "on" : ""} onClick={() => setAudioTab(k)}>
                  {{ sfx: "효과음", bgm: "배경음악", mine: "내 오디오" }[k]}
                </button>
              ))}
            </div>
            {audioTab === "mine" ? (
              <>
                <div className="resource-head">
                  <button className="primary-btn" onClick={importDialog}>
                    <FolderOpen size={15} /> 가져오기
                  </button>
                </div>
                <div className="media-grid">{audioList.map((m) => <MediaCard key={m.id} m={m} />)}</div>
                {audioList.length === 0 && <p className="muted small">가져온 음악·녹음 파일이 여기에 표시됩니다.</p>}
              </>
            ) : (
              <div className="sound-list">
                {SOUNDS.filter((s) => s.category === (audioTab === "sfx" ? "효과음" : "배경음악")).map((s) => (
                  <button key={s.id} className="sound-row" onClick={() => addSound(s.id)} title="재생헤드 위치에 추가">
                    <Play size={13} />
                    <span className="sound-name">{s.name}</span>
                    <span className="muted small">{s.duration.toFixed(1)}초</span>
                    <Plus size={14} />
                  </button>
                ))}
                <p className="muted small">모든 소리는 ZapCut이 직접 합성합니다. 처음 추가할 때 한 번 만들어집니다.</p>
              </div>
            )}
          </>
        )}

        {tab === "text" && (
          <>
            <div className="sub-tabs">
              <button className={textTab === "template" ? "on" : ""} onClick={() => setTextTab("template")}>
                텍스트 템플릿
              </button>
              <button className={textTab === "title" ? "on" : ""} onClick={() => setTextTab("title")}>
                타이틀 템플릿
              </button>
              <button className={textTab === "basic" ? "on" : ""} onClick={() => setTextTab("basic")}>
                기본
              </button>
            </div>
            {textTab === "title" ? (
              <Categorized
                categories={TITLE_CATEGORIES}
                items={TITLE_TEMPLATES}
                cat={(t) => t.category}
                className="title-grid"
                render={(t) => (
                  <button key={t.id} className="title-preset" onClick={() => useEditor.getState().addTitle(t)} title="재생헤드 위치에 넣기 (마우스를 올리면 미리보기)">
                    <TitleThumb def={t} />
                    <small>{t.name}</small>
                  </button>
                )}
              />
            ) : textTab === "basic" ? (
              <div className="resource-head">
                <button className="primary-btn" onClick={() => useEditor.getState().addText()}>
                  <Plus size={15} /> 기본 텍스트 추가
                </button>
              </div>
            ) : (
              <Categorized
                categories={TEXT_TEMPLATE_CATEGORIES}
                items={TEXT_TEMPLATES}
                cat={(t) => t.category}
                render={(t) => (
                  <button key={t.id} className="text-preset" onClick={() => useEditor.getState().applyTextTemplate(t)} title={[t.animIn && "등장", t.animLoop && "반복", t.animOut && "퇴장"].filter(Boolean).join(" · ") + " 애니메이션"}>
                    <span
                      style={{
                        color: t.style.color ?? "#fff",
                        backgroundImage: t.style.color2 ? `linear-gradient(${t.style.color}, ${t.style.color2})` : undefined,
                        WebkitBackgroundClip: t.style.color2 ? "text" : undefined,
                        WebkitTextFillColor: t.style.color2 ? "transparent" : undefined,
                        WebkitTextStroke: t.style.strokeWidth ? `1.5px ${t.style.strokeColor ?? "#000"}` : undefined,
                        background: t.style.background || undefined,
                        borderRadius: t.style.bgRadius ? 8 : undefined,
                        fontStyle: t.style.italic ? "italic" : undefined,
                        fontFamily: t.style.fontFamily,
                        textShadow: t.style.glow ? `0 0 8px ${t.style.glow}` : undefined,
                      }}
                    >
                      {t.content.split("\n")[0].slice(0, 8)}
                    </span>
                    <small>{t.name}</small>
                  </button>
                )}
              />
            )}
          </>
        )}

        {tab === "sticker" && (
          <Categorized
            categories={STICKER_CATEGORIES}
            items={STICKERS}
            cat={(s) => s.category}
            className="sticker-grid"
            render={(s) => (
              <button key={s.id} className="sticker-cell" title={s.name} onClick={() => addSticker(s)}>
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`} alt={s.name} draggable={false} />
              </button>
            )}
          />
        )}

        {tab === "effect" && (
          <>
            <h4 className="res-sub">가리기</h4>
            <div className="cover-row">
              {COVERS.map((c) => (
                <button key={c.name} className="chip" onClick={() => useEditor.getState().addEffect(c.effect, { params: c.params })} title="화면 일부만 가립니다. 미리보기에서 상자를 끌어 옮기고 모서리로 크기를 바꿉니다">
                  <EyeOff size={13} /> {c.name}
                </button>
              ))}
              <button className="chip" onClick={() => findFaces()} title="재생헤드 화면에서 얼굴을 찾습니다. 찾은 얼굴을 누르면 모자이크로 가리고 끝까지 따라갑니다">
                <ScanFace size={13} /> 얼굴 찾기
              </button>
            </div>
            <p className="muted small">누르면 재생헤드 위치의 효과 트랙에 3초짜리 효과가 놓입니다. 그 아래 모든 화면에 적용되며, 속성 패널의 '영역' 탭에서 일부만 적용할 수도 있습니다.</p>
            <Categorized
              categories={EFFECT_CATEGORIES}
              items={EFFECTS}
              cat={(e) => e.category}
              render={(e) => (
                <button key={e.id} className="fx-preset" onClick={() => useEditor.getState().addEffect(e.id)}>
                  <span className={`fx-icon fx-${e.category}`}>
                    <Sparkles size={18} />
                  </span>
                  <small>{e.name}</small>
                </button>
              )}
            />
          </>
        )}

        {tab === "transition" && (
          <>
            <p className="muted small">타임라인의 컷(+)이나 트랙 위로 끌어다 놓으면 그 자리에 들어갑니다. 누르면 선택한 클립 뒤(선택이 없으면 메인 트랙에서 재생헤드와 가장 가까운 컷)에 들어갑니다. 길이는 속성 패널에서 바꿀 수 있습니다.</p>
            <Categorized
              categories={TRANSITION_CATEGORIES}
              items={TRANSITIONS}
              cat={(t) => t.category}
              render={(t) => (
                <div
                  key={t.id}
                  className="fx-preset"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TRANSITION_DND, t.id);
                    e.dataTransfer.effectAllowed = "copy";
                    document.body.classList.add("dragging-transition");
                  }}
                  onDragEnd={() => document.body.classList.remove("dragging-transition")}
                >
                  <button className="tr-icon" onClick={() => applyTransition(t.id)} title="누르면 적용, 타임라인의 컷으로 끌어다 놓아도 됩니다">
                    <TransitionThumb kind={t.kind} />
                  </button>
                  <small>{t.name}</small>
                  <button className="link tiny" onClick={() => applyTransition(t.id, true)}>
                    모두 적용
                  </button>
                </div>
              )}
            />
          </>
        )}

        {tab === "filter" && (
          <>
            <p className="muted small">영상/사진(또는 조정 레이어)을 선택한 뒤 누르세요. 강도는 속성 패널의 ‘조정’ 탭에서 바꿉니다.</p>
            <Categorized
              categories={FILTER_CATEGORIES}
              items={[{ id: "", name: "원본", category: "", look: {} }, ...FILTER_PRESETS]}
              cat={(f) => f.category}
              render={(f) => (
                <button key={f.id || "none"} className="filter-preset" onClick={() => applyFilter(f.id)}>
                  <span className="swatch" style={{ background: f.id ? presetSwatch(f) : "linear-gradient(135deg,#e8b48a 30%,#4f8fd6 30% 55%,#5fae6a 55% 80%,#30303a 80%)" }} />
                  <small>{f.name}</small>
                </button>
              )}
            />
          </>
        )}

        {tab === "adjust" && (
          <div className="adjust-intro">
            <button className="primary-btn" onClick={() => useEditor.getState().addAdjustLayer()}>
              <Plus size={15} /> 조정 레이어 추가
            </button>
            <p className="muted small">조정 레이어는 효과 트랙에 놓여 그 아래 모든 화면의 색(밝기·대비·채도·색온도·하이라이트·그림자 등)과 필터를 한꺼번에 바꿉니다.</p>
            <p className="muted small">클립 하나만 바꾸려면 클립을 선택하고 속성 패널의 ‘조정’ 탭을 쓰세요. 외부 .cube LUT도 거기서 불러올 수 있습니다.</p>
          </div>
        )}

        {tab === "template" && (
          <>
            <p className="muted small">가져온 사진·동영상이 순서대로 슬롯에 들어갑니다. 템플릿은 전환·필터·카메라 움직임·텍스트·효과·스티커·음악을 한 번에 적용하는 묶음이며, 적용 후 자유롭게 고칠 수 있습니다.</p>
            <Categorized
              categories={TEMPLATE_CATEGORIES}
              items={TEMPLATES}
              cat={(t) => t.category}
              className="template-list"
              render={(t) => (
                <div key={t.id} className="template-card" style={{ "--accent": t.accent } as React.CSSProperties}>
                  <div className="template-thumb">
                    <span className="template-aspect">{t.aspect}</span>
                    <b>{t.name}</b>
                  </div>
                  <div className="template-info">
                    <p>{t.description}</p>
                    <span className="muted small">
                      슬롯 {t.slots}개 · {(t.slots * t.slotDuration).toFixed(0)}초
                    </span>
                    <button className="primary-btn small" onClick={() => applyTemplate(t)}>
                      적용
                    </button>
                  </div>
                </div>
              )}
            />
          </>
        )}
      </div>
    </div>
  );
}
