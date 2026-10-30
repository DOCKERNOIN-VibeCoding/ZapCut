// 텍스트 탭 > 자막: 자동 캡션 실행, 자막 목록 편집, SRT 내보내기
import { Captions, Download, Scissors, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { CAPTION_LANGS, CAPTION_MODELS, toSrt } from "../core/captions";
import { autoCaption, captionTargets } from "../editor/captions";
import { applySilence, DEFAULT_SILENCE, findSilence, silenceTargets, type SilenceOptions } from "../editor/silence";
import { useEditor } from "../editor/store";
import { shortTime } from "./format";

// 마지막으로 쓴 무음 설정은 이 PC에 남긴다 (범위를 벗어나거나 깨진 값은 기본값)
const SIL_KEY = "zapcut.silence";
const SIL_RANGE: Record<keyof SilenceOptions, [number, number]> = { noiseDb: [-60, -15], minDur: [0.2, 3], pad: [0, 0.5] };
function loadSilence(): SilenceOptions {
  try {
    const v = JSON.parse(localStorage.getItem(SIL_KEY) ?? "null") as Partial<SilenceOptions> | null;
    const out = { ...DEFAULT_SILENCE };
    for (const k of Object.keys(SIL_RANGE) as (keyof SilenceOptions)[]) {
      const n = Number(v?.[k]);
      if (Number.isFinite(n)) out[k] = Math.min(SIL_RANGE[k][1], Math.max(SIL_RANGE[k][0], n));
    }
    return out;
  } catch {
    return DEFAULT_SILENCE;
  }
}
const isDefaultSilence = (v: SilenceOptions) => (Object.keys(SIL_RANGE) as (keyof SilenceOptions)[]).every((k) => v[k] === DEFAULT_SILENCE[k]);

export function CaptionPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const busy = useEditor((s) => s.busy);
  const [lang, setLang] = useState("ko");
  const [model, setModel] = useState("large");
  const [have, setHave] = useState<string[]>([]);
  const [sil, setSilRaw] = useState(loadSilence);
  const preview = useEditor((s) => s.silencePreview);
  const live = preview && preview.project === project ? preview : undefined;
  // 설정을 바꾸면 미리 본 결과는 더 이상 맞지 않는다
  const setSil = (v: typeof sil) => {
    setSilRaw(v);
    try {
      localStorage.setItem(SIL_KEY, JSON.stringify(v));
    } catch {
      // 저장 공간을 쓸 수 없어도 이번 실행에서는 그대로 동작
    }
    useEditor.getState().setSilencePreview(undefined);
  };
  const refresh = () => window.zapcut.captionModels().then(setHave).catch(() => undefined);
  useEffect(() => {
    refresh();
  }, []);
  const captions = project.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.caption)
    .sort((a, b) => a.start - b.start);
  const targets = captionTargets(project, selection);
  const selectedTargets = targets.some((c) => selection.includes(c.id));

  return (
    <>
      <p className="muted small">
        {targets.length ? `${selectedTargets ? "선택한 클립" : "소리가 있는 모든 클립"} ${targets.length}개의 말소리를 받아 적어 자막 클립으로 만듭니다.` : "소리가 있는 영상이나 오디오 클립을 타임라인에 놓으세요."} 이 PC에서만 처리하며, 인터넷은 모델을 처음 받을 때만 씁니다.
      </p>
      <div className="field">
        <label>언어</label>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {CAPTION_LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>모델</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {CAPTION_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {have.includes(m.file) ? "" : " · 받기 필요"}
            </option>
          ))}
        </select>
      </div>
      <div className="cover-row">
        <button className="primary-btn" disabled={!!busy || !targets.length} onClick={() => autoCaption({ language: lang, modelId: model }).then(refresh)}>
          <Captions size={14} /> 자동 캡션
        </button>
        {busy && (
          <button className="ghost-btn" onClick={() => window.zapcut.cancelCaption()}>
            취소
          </button>
        )}
        <button
          className="ghost-btn"
          disabled={!captions.length}
          onClick={async () => {
            const f = await window.zapcut.saveSrt(toSrt(captions), project.name);
            if (f) useEditor.getState().notify(`SRT로 저장했습니다: ${f}`);
          }}
        >
          <Download size={14} /> SRT 내보내기
        </button>
      </div>
      <h4 className="res-sub">무음 구간 잘라내기</h4>
      <p className="muted small">
        {silenceTargets(project, selection).length ? `${silenceTargets(project, selection).some((c) => selection.includes(c.id)) ? "선택한 클립" : "메인 트랙 영상"}의 말소리 사이 빈 구간을 찾아` : "메인 트랙에 소리 있는 영상을 놓으면 그 빈 구간을 찾아"} 모든 트랙(영상·소리·자막)에서 잘라내고 뒤를 당겨 붙입니다. 자동 캡션 뒤에 쓰면 자막도 함께 정리됩니다.
      </p>
      <div className="field">
        <label>기준 음량</label>
        <input type="range" min={-60} max={-15} step={1} value={sil.noiseDb} onChange={(e) => setSil({ ...sil, noiseDb: +e.target.value })} />
        <span className="unit">{sil.noiseDb} dB</span>
      </div>
      <div className="field">
        <label>최소 길이</label>
        <input type="range" min={0.2} max={3} step={0.1} value={sil.minDur} onChange={(e) => setSil({ ...sil, minDur: +e.target.value })} />
        <span className="unit">{sil.minDur.toFixed(1)}초</span>
      </div>
      <div className="field">
        <label>앞뒤 여유</label>
        <input type="range" min={0} max={0.5} step={0.05} value={sil.pad} onChange={(e) => setSil({ ...sil, pad: +e.target.value })} />
        <span className="unit">{sil.pad.toFixed(2)}초</span>
      </div>
      <p className="small">
        <button className="link tiny" disabled={isDefaultSilence(sil)} onClick={() => setSil(DEFAULT_SILENCE)} title="-35 dB · 0.6초 · 0.15초">
          기본값으로 되돌리기
        </button>
        {!isDefaultSilence(sil) && <span className="muted"> · 마지막에 쓴 값입니다</span>}
      </p>
      <div className="cover-row">
        <button className={live ? "ghost-btn" : "primary-btn"} disabled={!!busy || !silenceTargets(project, selection).length} onClick={() => findSilence(sil)}>
          <Search size={14} /> 무음 찾기
        </button>
        {live && (
          <>
            <button className="primary-btn" onClick={() => applySilence()}>
              <Scissors size={14} /> 잘라내기 ({live.ranges.length}곳)
            </button>
            <button className="ghost-btn" onClick={() => useEditor.getState().setSilencePreview(undefined)}>
              취소
            </button>
          </>
        )}
      </div>
      {live && (
        <p className="small">
          무음 {live.ranges.length}곳, {live.total.toFixed(1)}초가 잘립니다 · 전체 {live.before.toFixed(1)}초 → {live.after.toFixed(1)}초. 타임라인의 빨간 구간을 확인하세요.
        </p>
      )}
      <h4 className="res-sub">자막 목록 ({captions.length})</h4>
      {captions.length === 0 && <p className="muted small">아직 자막이 없습니다. 자동 캡션을 누르면 여기에 문장별로 나옵니다.</p>}
      <div className="caption-list">
        {captions.map((c) => (
          <div key={c.id} className={`caption-row ${selection.includes(c.id) ? "on" : ""}`}>
            <button
              className="link tiny"
              title="이 자막으로 이동"
              onClick={() => {
                const s = useEditor.getState();
                s.setPlayhead(c.start);
                s.select([c.id]);
              }}
            >
              {shortTime(c.start)}
            </button>
            <textarea rows={1} value={c.text!.content} onChange={(e) => useEditor.getState().updateClip(c.id, (x) => ({ ...x, text: { ...x.text!, content: e.target.value } }))} />
          </div>
        ))}
      </div>
    </>
  );
}
