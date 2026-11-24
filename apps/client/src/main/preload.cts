import electron = require("electron");

import type { LauncherApi, Progress, Settings } from "./contract.js";

const { contextBridge, ipcRenderer } = electron;

const api: LauncherApi = {
  getSettings: () => ipcRenderer.invoke("launcher:get-settings"),
  saveSettings: (value: Settings) =>
    ipcRenderer.invoke("launcher:save-settings", value),
  getStatus: () => ipcRenderer.invoke("launcher:get-status"),
  getProgress: () => ipcRenderer.invoke("launcher:get-progress"),
  play: () => ipcRenderer.invoke("launcher:play"),
  onProgress(listener) {
    const receive = (_event: Electron.IpcRendererEvent, progress: Progress) =>
      listener(progress);
    ipcRenderer.on("launcher:progress", receive);
    return () => ipcRenderer.removeListener("launcher:progress", receive);
  },
};

contextBridge.exposeInMainWorld("launcher", api);
