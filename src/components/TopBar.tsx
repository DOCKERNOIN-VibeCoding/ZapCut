import { FilePlus2, FolderOpen, Save, Upload, Zap } from "lucide-react";
import pkg from "../../package.json";
import { newProject } from "../core/timeline";
import { useEditor } from "../editor/store";

export async function saveProject(saveAs = false) {
  const s = useEditor.getState();
  const path = await window.zapcut.saveProject(s.project, saveAs ? undefined : s.filePath);
  if (path) {
    s.markSaved(path);
    // 저장했으므로 복구용 자동 저장은 비운다
    window.zapcut.autosave(newProject());
    s.notify("저장했습니다");
  }
}

export async function openProject(filePath?: string) {
  const s = useEditor.getState();
  if (s.dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 계속할까요?")) return;
  const r = await window.zapcut.openProject(filePath);
  if (!r) return;
  s.load(r.project, r.filePath);
  if (r.missing.length) s.notify(`찾을 수 없는 미디어 ${r.missing.length}개: ${r.missing.map((m: string) => m.split(/[\\/]/).pop()).join(", ")}`, "error");
}

export function TopBar({ onExport }: { onExport: () => void }) {
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);
  const s = useEditor.getState;
  return (
    <div className="topbar">
      <div className="brand">
        <Zap size={18} className="brand-icon" />
        ZapCut
        <span className="version-badge">{pkg.displayVersion}</span>
      </div>
      <div className="menu">
        <button
          className="menu-btn"
          title="새 프로젝트"
          onClick={() => {
            if (s().dirty && !confirm("저장하지 않은 변경 사항이 있습니다. 새 프로젝트를 만들까요?")) return;
            s().load(newProject());
          }}
        >
          <FilePlus2 size={15} /> 새로 만들기
        </button>
        <button className="menu-btn" title="열기" onClick={() => openProject()}>
          <FolderOpen size={15} /> 열기
        </button>
        <button className="menu-btn" title="저장 (Ctrl+S)" onClick={() => saveProject()}>
          <Save size={15} /> 저장
        </button>
      </div>
      <div className="project-name">
        <input value={name} onChange={(e) => s().setProjectProps({ name: e.target.value })} spellCheck={false} />
        {dirty && <span className="dirty" title="저장되지 않음">●</span>}
      </div>
      <button className="export-btn" onClick={onExport} title="내보내기 (Ctrl+E)">
        <Upload size={15} /> 내보내기
      </button>
    </div>
  );
}
