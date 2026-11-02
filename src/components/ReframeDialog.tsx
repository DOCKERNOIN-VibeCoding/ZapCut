import { X } from "lucide-react";
import { useState } from "react";
import { cropAspect, reframeTargets, sourceAspect, type ReframeFit } from "../core/reframe";
import { canvasSize, RATIOS, tierLabel, TIERS } from "../core/timeline";
import { reframe, reframeMessage, type ReframeAnchor } from "../editor/reframe";
import { useEditor } from "../editor/store";

/** 포맷 변환: 캔버스 비율을 바꾸고 메인 트랙의 영상·사진을 새 비율에 맞게 자른다 (16:9 롱폼 → 9:16 숏폼 등). 외부 제어(MCP)의 reframe과 같은 옵션 */
export function ReframeDialog({ onClose }: { onClose: () => void }) {
  const p = useEditor((s) => s.project);
  const busy = useEditor((s) => s.busy);
  const cur = Math.min(p.width, p.height);
  const [ratio, setRatio] = useState(p.width >= p.height ? "9:16" : "16:9");
  const [short, setShort] = useState(TIERS.includes(cur) ? cur : 1080);
  const [anchor, setAnchor] = useState<ReframeAnchor>("center");
  const [fit, setFit] = useState<ReframeFit>("fill");
  const [blur, setBlur] = useState(true);
  const r = RATIOS.find((x) => x.label === ratio) ?? RATIOS[0];
  const size = canvasSize(r.w, r.h, short);
  const target = size.width / size.height;
  const targets = reframeTargets(p);
  // 꽉 채우기와 1:1 자르기가 다른 결과를 내는 클립이 있을 때만 고르게 한다 (대상이 1:1이거나 가로형이면 같다)
  const hasBox = targets.some(({ clip, media }) => Math.abs(cropAspect(sourceAspect(clip, media), target, "box") - target) > 1e-3);
  const box = hasBox && fit === "box";

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await reframe({ ...size, anchor, fit: box ? "box" : "fill", blur });
    useEditor.getState().notify(reframeMessage(res));
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={run}>
        <div className="modal-head">
          <h3>포맷 변환</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="ratio-grid">
            {RATIOS.map((o) => {
              const k = 26 / Math.max(o.w, o.h);
              return (
                <button type="button" key={o.label} className={`ratio-opt ${ratio === o.label ? "on" : ""}`} onClick={() => setRatio(o.label)}>
                  <span className="ratio-shape" style={{ width: o.w * k, height: o.h * k }} />
                  {o.label}
                </button>
              );
            })}
          </div>
          <div className="field">
            <label>해상도</label>
            <select value={short} onChange={(e) => setShort(+e.target.value)}>
              {TIERS.map((t) => {
                const c = canvasSize(r.w, r.h, t);
                return (
                  <option key={t} value={t}>
                    {tierLabel(t)} ({c.width} × {c.height})
                  </option>
                );
              })}
            </select>
          </div>
          <div className="field">
            <label>기준</label>
            <div className="chips">
              <button type="button" className={`chip ${anchor === "center" ? "on" : ""}`} onClick={() => setAnchor("center")}>
                가운데
              </button>
              <button type="button" className={`chip ${anchor === "face" ? "on" : ""}`} onClick={() => setAnchor("face")} title="클립마다 몇 장면에서 얼굴을 찾아 인물을 가운데에 둡니다. 못 찾으면 가운데">
                얼굴
              </button>
            </div>
          </div>
          {hasBox && (
            <div className="field">
              <label>자르기</label>
              <div className="chips">
                <button type="button" className={`chip ${fit === "fill" ? "on" : ""}`} onClick={() => setFit("fill")} title={`${ratio}로 잘라 화면을 가득 채웁니다`}>
                  꽉 채우기
                </button>
                <button type="button" className={`chip ${fit === "box" ? "on" : ""}`} onClick={() => setFit("box")} title="1:1까지만 자르고 남는 위아래(또는 양옆)는 비워 둡니다">
                  1:1로 자르고 여백
                </button>
              </div>
            </div>
          )}
          {box && (
            <label className="check">
              <input type="checkbox" checked={blur} onChange={(e) => setBlur(e.target.checked)} /> 여백을 흐린 원본으로 채우기 (끄면 배경색)
            </label>
          )}
          <p className="muted small">
            {targets.length ? `메인 트랙의 영상·사진 ${targets.length}개를 ${size.width} × ${size.height}에 맞게 자릅니다.` : `${size.width} × ${size.height}으로 바꿉니다 (메인 트랙에 자를 영상·사진이 없음).`} 텍스트·타이틀은 화면 폭의 90% 안에 들어오게
            줄입니다. Ctrl+Z로 되돌릴 수 있습니다.
          </p>
        </div>
        <div className="modal-foot">
          <button type="button" className="ghost-btn" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary-btn" autoFocus disabled={!!busy}>
            {busy ? `${busy} 중…` : "변환"}
          </button>
        </div>
      </form>
    </div>
  );
}
