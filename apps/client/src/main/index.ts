import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { app, type BrowserWindow, nativeTheme } from "electron";
import { createLauncherWindow } from "./window.js";

app.setName("GLauncher");
const data = join(app.getPath("appData"), "GLauncher");
mkdirSync(data, { recursive: true });
app.setPath("userData", data);
nativeTheme.themeSource = "dark";

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let window: BrowserWindow | undefined;
  app.on("second-instance", () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(async () => {
      window = await createLauncherWindow();
    })
    .catch((error: unknown) => {
      console.error("Не удалось открыть GLauncher:", error);
      app.exit(1);
    });
}
