import { contextBridge, ipcRenderer, webUtils } from "electron";

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
  startExport: (project: unknown, settings: unknown, textPngs: Record<string, string>, outPath: string) =>
    ipcRenderer.invoke("export:start", project, settings, textPngs, outPath),
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
  onImportExternal: (fn: (files: string[]) => void) => {
    ipcRenderer.on("media:importExternal", (_e, f: string[]) => fn(f));
  },
};

contextBridge.exposeInMainWorld("zapcut", api);
export type ZapcutApi = typeof api;
