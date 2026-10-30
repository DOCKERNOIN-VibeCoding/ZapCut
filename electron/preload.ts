import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { TrackRequest, UpdateStatus } from "./main";

const api = {
  pickMedia: (): Promise<string[]> => ipcRenderer.invoke("media:pick"),
  probeMedia: (file: string) => ipcRenderer.invoke("media:probe", file),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  saveProject: (project: unknown, filePath?: string): Promise<string | undefined> => ipcRenderer.invoke("project:save", project, filePath),
  openProject: (filePath?: string) => ipcRenderer.invoke("project:open", filePath),
  pendingProject: (): Promise<string | undefined> => ipcRenderer.invoke("project:pending"),
  autosave: (project: unknown) => ipcRenderer.invoke("project:autosave", project),
  recover: () => ipcRenderer.invoke("project:recover"),
  pickExportPath: (name: string, format: string): Promise<string | undefined> => ipcRenderer.invoke("export:pickPath", name, format),
  encoders: (): Promise<string[]> => ipcRenderer.invoke("export:encoders"),
  startExport: (project: unknown, settings: unknown, texts: Record<string, { w: number; h: number; frames: { png: string; from: number; to: number }[] }>, outPath: string) =>
    ipcRenderer.invoke("export:start", project, settings, texts, outPath),
  cancelExport: () => ipcRenderer.invoke("export:cancel"),
  showItem: (p: string) => ipcRenderer.invoke("shell:showItem", p),
  onExportProgress: (fn: (v: number) => void) => {
    const h = (_e: unknown, v: number) => fn(v);
    ipcRenderer.on("export:progress", h);
    return () => {
      ipcRenderer.removeListener("export:progress", h);
    };
  },
  onOpenExternal: (fn: (file: string) => void) => {
    ipcRenderer.on("project:openExternal", (_e, f: string) => fn(f));
  },
  pendingMedia: (): Promise<string[]> => ipcRenderer.invoke("media:pending"),
  needsProxy: (item: unknown): Promise<boolean> => ipcRenderer.invoke("media:needsProxy", item),
  makeProxy: (file: string): Promise<string> => ipcRenderer.invoke("media:makeProxy", file),
  freezeFrame: (file: string, time: number): Promise<string> => ipcRenderer.invoke("media:freeze", file, time),
  reverseRange: (file: string, start: number, length: number, hasAudio: boolean): Promise<string> => ipcRenderer.invoke("media:reverse", file, start, length, hasAudio),
  savePng: (name: string, dataUrl: string): Promise<string> => ipcRenderer.invoke("asset:savePng", name, dataUrl),
  generateSound: (id: string): Promise<string> => ipcRenderer.invoke("sound:generate", id),
  pickCube: (): Promise<string | undefined> => ipcRenderer.invoke("cube:pick"),
  readCube: (file: string): Promise<{ size: number; data: Float32Array } | undefined> => ipcRenderer.invoke("cube:read", file),
  onImportExternal: (fn: (files: string[]) => void) => {
    ipcRenderer.on("media:importExternal", (_e, f: string[]) => fn(f));
  },
  onUpdateStatus: (fn: (s: UpdateStatus) => void) => {
    const h = (_e: unknown, s: UpdateStatus) => fn(s);
    ipcRenderer.on("update:status", h);
    return () => {
      ipcRenderer.removeListener("update:status", h);
    };
  },
  installUpdate: () => ipcRenderer.invoke("update:install"),
  mlRead: (name: "yunet.onnx" | "ort.wasm"): Promise<Uint8Array> => ipcRenderer.invoke("ml:read", name),
  grabFrame: (file: string, time: number): Promise<Uint8Array> => ipcRenderer.invoke("frame:grab", file, time),
  trackRegion: (req: TrackRequest): Promise<{ boxes: { x: number; y: number; w: number; h: number }[]; lostAt?: number }> => ipcRenderer.invoke("track:run", req),
  onTrackProgress: (fn: (v: number) => void) => {
    const h = (_e: unknown, v: number) => fn(v);
    ipcRenderer.on("track:progress", h);
    return () => {
      ipcRenderer.removeListener("track:progress", h);
    };
  },
  checkUpdate: (): Promise<{ state: "dev" | "latest" } | { state: "available"; version: string } | { state: "error"; message: string }> => ipcRenderer.invoke("update:check"),
  openLicense: (key: string): Promise<string> => ipcRenderer.invoke("license:open", key),
};

contextBridge.exposeInMainWorld("zapcut", api);
export type ZapcutApi = typeof api;
