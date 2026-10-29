import { FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { outputSize, type ExportSettings, type Quality, type VideoEncoder } from "../core/exportPlan";
import { canvasSize, projectDuration, tierLabel, TIERS } from "../core/timeline";
import { renderTextAssets } from "../editor/exportAssets";
import { useEditor } from "../editor/store";

const ENCODER_LABEL: Record<string, string> = {
  libx264: "CPU (x264)",
  h264_nvenc: "NVIDIA GPU (NVENC)",
  h264_qsv: "Intel GPU (Quick Sync)",
  h264_amf: "AMD GPU (AMF)",
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [name, setName] = useState(project.name);
  // 해상도 선택지는 등급(짧은 변)별 출력 세로 크기. 기본은 프로젝트 해상도에 가장 가까운 등급
  const heights = TIERS.map((t) => canvasSize(project.width, project.height, t).height);
  const short = Math.min(project.width, project.height);
  const nearest = TIERS.reduce((a, t) => (Math.abs(t - short) < Math.abs(a - short) ? t : a));
  const [settings, setSettings] = useState<ExportSettings>({ height: heights[TIERS.indexOf(nearest)], fps: project.fps, quality: "high", encoder: "libx264", format: "mp4" });
  const [encoders, setEncoders] = useState<string[]>(["libx264"]);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; path?: string; error?: string } | null>(null);
  const total = projectDuration(project);
  const size = outputSize(project, settings.height);

  useEffect(() => {
    window.zapcut.encoders().then((list) => {
      const h264 = list.filter((e) => e in ENCODER_LABEL);
      setEncoders(h264.length ? h264 : ["libx264"]);
      // GPU 인코더가 있으면 기본으로 선택
      const gpu = h264.find((e) => e !== "libx264");
      if (gpu) setSettings((s) => ({ ...s, encoder: gpu as VideoEncoder }));
    });
    return window.zapcut.onExportProgress(setProgress);
  }, []);

  const start = async () => {
    const out = await window.zapcut.pickExportPath(name || "ZapCut", settings.format);
    if (!out) return;
    setResult(null);
    setProgress(0);
    const pngs = renderTextAssets(project, size.height, settings.fps);
    let r = await window.zapcut.startExport(project, settings, pngs, out);
    // GPU 인코더 실패 시 CPU로 재시도
    if (!r.ok && settings.encoder !== "libx264" && !/취소/.test(r.error ?? "")) {
      setProgress(0);
      r = await window.zapcut.startExport(project, { ...settings, encoder: "libx264" }, pngs, out);
    }
    setProgress(null);
    setResult(r);
  };

  const busy = progress !== null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <h3>내보내기</h3>
          {!busy && (
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
        {total <= 0 ? (
          <p className="muted">타임라인이 비어 있습니다. 먼저 미디어를 추가하세요.</p>
        ) : (
          <div className="modal-body">
            <div className="field">
              <label>파일 이름</label>
              <input className="text" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label>해상도</label>
              <select value={settings.height} disabled={busy} onChange={(e) => setSettings({ ...settings, height: +e.target.value })}>
                {heights.map((h, i) => (
                  <option key={h} value={h}>
                    {tierLabel(TIERS[i])} ({outputSize(project, h).width}×{outputSize(project, h).height})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>프레임 속도</label>
              <select value={settings.fps} disabled={busy} onChange={(e) => setSettings({ ...settings, fps: +e.target.value })}>
                {[24, 25, 30, 50, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>품질</label>
              <select value={settings.quality} disabled={busy} onChange={(e) => setSettings({ ...settings, quality: e.target.value as Quality })}>
                <option value="high">높음 (권장)</option>
                <option value="medium">보통</option>
                <option value="low">낮음 (작은 파일)</option>
              </select>
            </div>
            <div className="field">
              <label>인코더</label>
              <select value={settings.encoder} disabled={busy} onChange={(e) => setSettings({ ...settings, encoder: e.target.value as VideoEncoder })}>
                {encoders.map((e) => (
                  <option key={e} value={e}>
                    {ENCODER_LABEL[e]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>형식</label>
              <select value={settings.format} disabled={busy} onChange={(e) => setSettings({ ...settings, format: e.target.value as "mp4" | "mov" })}>
                <option value="mp4">MP4 (H.264 + AAC)</option>
                <option value="mov">MOV (H.264 + AAC)</option>
              </select>
            </div>
            <p className="muted small">
              길이 {total.toFixed(1)}초 · {size.width}×{size.height}
            </p>
            {busy && (
              <div className="progress">
                <div className="bar" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                <span>{Math.round((progress ?? 0) * 100)}% 내보내는 중…</span>
              </div>
            )}
            {result?.ok && (
              <div className="result ok">
                내보내기 완료!
                <button className="link" onClick={() => window.zapcut.showItem(result.path!)}>
                  <FolderOpen size={14} /> 폴더 열기
                </button>
              </div>
            )}
            {result && !result.ok && <pre className="result err">{result.error}</pre>}
          </div>
        )}
        <div className="modal-foot">
          {busy ? (
            <button className="ghost-btn" onClick={() => window.zapcut.cancelExport()}>
              취소
            </button>
          ) : (
            <>
              <button className="ghost-btn" onClick={onClose}>
                닫기
              </button>
              <button className="primary-btn" disabled={total <= 0} onClick={start}>
                내보내기
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
