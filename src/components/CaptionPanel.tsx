// 텍스트 탭 > 자막: 자동 캡션 실행, 자막 목록 편집, SRT 내보내기
import { Captions, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { CAPTION_LANGS, CAPTION_MODELS, toSrt } from "../core/captions";
import { autoCaption, captionTargets } from "../editor/captions";
import { useEditor } from "../editor/store";
import { shortTime } from "./format";

export function CaptionPanel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const busy = useEditor((s) => s.busy);
  const [lang, setLang] = useState("ko");
  const [model, setModel] = useState("large");
  const [have, setHave] = useState<string[]>([]);
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
