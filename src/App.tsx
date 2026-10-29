import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { Player } from "./components/Player";
import { ResourcePanel } from "./components/ResourcePanel";
import { Timeline } from "./components/Timeline";
import { openProject, saveProject, TopBar } from "./components/TopBar";
import { projectDuration } from "./core/timeline";
import { useEditor } from "./editor/store";

function useShortcuts(openExport: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["range", "checkbox", "color"].includes((el as HTMLInputElement).type)) || el.tagName === "SELECT") return;
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const frame = 1 / s.project.fps;
      const handled = () => e.preventDefault();
      if (key === " ") return handled(), s.setPlaying(!s.playing);
      if (ctrl && key === "z" && e.shiftKey) return handled(), s.redo();
      if (ctrl && key === "z") return handled(), s.undo();
      if (ctrl && key === "y") return handled(), s.redo();
      if (ctrl && key === "b") return handled(), s.splitAtPlayhead();
      if (ctrl && key === "c") return handled(), s.copy();
      if (ctrl && key === "v") return handled(), s.paste();
      if (ctrl && key === "s") return handled(), saveProject(e.shiftKey);
      if (ctrl && key === "o") return handled(), openProject();
      if (ctrl && key === "e") return handled(), openExport();
      if (ctrl && key === "i") return handled(), window.zapcut.pickMedia().then((p) => (p.length ? s.importFiles(p) : undefined));
      if (ctrl && (key === "=" || key === "+")) return handled(), s.setZoom(s.zoom * 1.25);
      if (ctrl && key === "-") return handled(), s.setZoom(s.zoom / 1.25);
      if (ctrl && key === "a") return handled(), s.select(s.project.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      if (ctrl) return;
      if (key === "delete" || key === "backspace") return handled(), s.deleteSelected();
      if (key === "q") return handled(), s.trimSide("left");
      if (key === "w") return handled(), s.trimSide("right");
      if (key === "n") return handled(), s.toggleSnapping();
      if (key === "arrowleft") return handled(), s.setPlayhead(s.playhead - (e.shiftKey ? 1 : frame));
      if (key === "arrowright") return handled(), s.setPlayhead(s.playhead + (e.shiftKey ? 1 : frame));
      if (key === "arrowup") return handled(), s.jumpEdit(-1);
      if (key === "arrowdown") return handled(), s.jumpEdit(1);
      if (key === "home") return handled(), s.setPlayhead(0);
      if (key === "end") return handled(), s.setPlayhead(projectDuration(s.project));
      if (key === "escape") return s.select([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openExport]);
}

function Toast() {
  const toast = useEditor((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), toast.kind === "error" ? 6000 : 2500);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast || !visible) return null;
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>;
}

function Busy() {
  const busy = useEditor((s) => s.busy);
  return busy ? <div className="busy">{busy} 중…</div> : null;
}

export function App() {
  const [exporting, setExporting] = useState(false);
  // "startup"은 프로그램 시작 시라 취소할 수 없다
  const [creating, setCreating] = useState<"startup" | "new" | null>(null);
  useShortcuts(() => setExporting(true));

  // 시작: 파일 연결로 열린 프로젝트/미디어 → 자동 저장 복구 → 새 프로젝트 창
  useEffect(() => {
    const importAndPlace = async (files: string[]) => {
      const items = await useEditor.getState().importFiles(files);
      for (const m of items) {
        const s = useEditor.getState();
        // 영상/이미지는 메인 트랙 끝에 이어 붙이고, 오디오는 처음부터 깐다
        if (m.kind === "audio") s.addMediaToTimeline(m.id, 0);
        else {
          s.setPlayhead(projectDuration(s.project));
          s.addMediaToTimeline(m.id);
        }
      }
      useEditor.getState().setPlayhead(0);
    };
    (async () => {
      const pending = await window.zapcut.pendingProject();
      if (pending) return openProject(pending);
      const media = await window.zapcut.pendingMedia();
      if (media.length) return importAndPlace(media);
      const recovered = await window.zapcut.recover();
      const hasContent = recovered && recovered.tracks.some((t: { clips: unknown[] }) => t.clips.length > 0);
      if (hasContent && confirm("이전에 저장하지 않고 종료한 작업이 있습니다. 복구할까요?")) useEditor.getState().load(recovered);
      else setCreating("startup");
    })();
    window.zapcut.onOpenExternal((f) => openProject(f));
    window.zapcut.onImportExternal((files) => importAndPlace(files));
  }, []);

  // 변경 사항 자동 저장 (5초 간격 확인)
  useEffect(() => {
    let last = useEditor.getState().project;
    const id = setInterval(() => {
      const { project } = useEditor.getState();
      if (project !== last) {
        last = project;
        window.zapcut.autosave(project);
      }
    }, 5000);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) window.zapcut.autosave(useEditor.getState().project);
      void e;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearInterval(id);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  return (
    <div className="app">
      <TopBar onNew={() => setCreating("new")} onExport={() => setExporting(true)} />
      <div className="workspace">
        <ResourcePanel />
        <Player />
        <Inspector />
      </div>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {creating && <NewProjectDialog onDone={() => setCreating(null)} onCancel={creating === "new" ? () => setCreating(null) : undefined} />}
      <Toast />
      <Busy />
    </div>
  );
}
