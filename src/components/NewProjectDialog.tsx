import { X } from "lucide-react";
import { useState } from "react";
import { canvasSize, newProject, RATIOS, tierLabel, TIERS } from "../core/timeline";
import { useEditor } from "../editor/store";

const FIT = "첫 소스에 맞춤";

/** 새 프로젝트의 틀(화면 비율·해상도·프레임 속도)을 정한다. onCancel이 없으면(프로그램 시작) 닫을 수 없다 */
export function NewProjectDialog({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const [ratio, setRatio] = useState("16:9");
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState(30);
  // 첫 소스에 맞춤은 소스를 가져오기 전까지 16:9로 둔다
  const r = RATIOS.find((x) => x.label === ratio) ?? RATIOS[0];
  const size = canvasSize(r.w, r.h, short);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    useEditor.getState().load(newProject(undefined, { ...size, fps, fitFirstMedia: ratio === FIT ? true : undefined }));
    onDone();
  };

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={create}>
        <div className="modal-head">
          <h3>새 프로젝트</h3>
          {onCancel && (
            <button type="button" className="icon-btn" onClick={onCancel}>
              <X size={16} />
            </button>
          )}
        </div>
        <div className="modal-body">
          <div className="ratio-grid">
            {[...RATIOS, { label: FIT, w: 0, h: 0 }].map((o) => {
              const k = 26 / Math.max(o.w, o.h, 1);
              return (
                <button type="button" key={o.label} className={`ratio-opt ${ratio === o.label ? "on" : ""}`} onClick={() => setRatio(o.label)}>
                  <span className={`ratio-shape ${o.w ? "" : "fit"}`} style={o.w ? { width: o.w * k, height: o.h * k } : undefined} />
                  {o.label}
                </button>
              );
            })}
          </div>
          <div className="field">
            <label>해상도</label>
            <select value={short} onChange={(e) => setShort(+e.target.value)}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {tierLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>프레임 속도</label>
            <select value={fps} onChange={(e) => setFps(+e.target.value)}>
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>
          <p className="muted small">
            {ratio === FIT ? `첫 영상·이미지의 비율로 정해집니다 (짧은 변 ${short}px)` : `${size.width} × ${size.height}`} · 나중에 속성 패널에서 바꿀 수 있습니다
          </p>
        </div>
        <div className="modal-foot">
          {onCancel && (
            <button type="button" className="ghost-btn" onClick={onCancel}>
              취소
            </button>
          )}
          <button type="submit" className="primary-btn" autoFocus>
            만들기
          </button>
        </div>
      </form>
    </div>
  );
}
