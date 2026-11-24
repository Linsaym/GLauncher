import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { registerLauncher, rendererPath } from "./launcher.js";

export async function createLauncherWindow(
  show = true,
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: "GLauncher",
    icon: fileURLToPath(new URL("../../assets/logo.ico", import.meta.url)),
    show: false,
    width: 800,
    height: 590,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#111616",
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  registerLauncher(window, app.getPath("userData"));
  await window.loadFile(rendererPath);
  if (show) window.show();
  return window;
}
