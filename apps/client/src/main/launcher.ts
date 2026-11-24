import { spawn } from "node:child_process";
import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { Progress } from "./contract.js";
import { javaEnvironment, prepareMinecraft } from "./minecraft.js";
import { getManifest, syncMods, updateOrigin } from "./mods.js";
import { addMinecraftServer } from "./servers.js";
import { readSettings, saveSettings } from "./settings.js";
import { getStatus } from "./status.js";
import { defaultGraphicsMods, installVisualPacks } from "./visuals.js";

export const rendererUrl = new URL("../renderer/index.html", import.meta.url);

async function runGame(
  root: string,
  game: string,
  launch: { java: string; args: string[] },
  started: () => void,
) {
  const log = await open(join(root, "game.log"), "w");
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.java, launch.args, {
        cwd: game,
        env: javaEnvironment(root),
        windowsHide: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("spawn", started);
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              "Minecraft завершился с кодом " +
                (code ?? "—") +
                ". Подробности в game.log.",
            ),
          );
      });
    });
  } finally {
    await log.close();
  }
}

export function registerLauncher(window: BrowserWindow, root: string) {
  let progress: Progress = { phase: "idle", message: "Готов к запуску" };
  let busy = false;
  let saving = false;
  const game = join(root, "game");

  function report(next: Progress) {
    progress = next;
    if (!window.isDestroyed())
      window.webContents.send("launcher:progress", next);
  }

  function handler<T>(channel: string, handle: (input: unknown) => T) {
    ipcMain.handle(
      `launcher:${channel}`,
      (event: IpcMainInvokeEvent, input: unknown) => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame?.url !== rendererUrl.href
        ) {
          throw new Error("Недопустимый источник запроса.");
        }
        return handle(input);
      },
    );
  }

  handler("get-settings", () => readSettings(root));
  handler("save-settings", async (input) => {
    if (busy || saving)
      throw new Error("Дождитесь завершения текущей операции.");
    saving = true;
    try {
      const settings = await saveSettings(root, input);
      report({ phase: "idle", message: "Готов к запуску" });
      return settings;
    } finally {
      saving = false;
    }
  });
  handler("get-status", async () => getStatus(await readSettings(root)));
  handler("get-progress", () => progress);
  handler("play", async () => {
    if (busy || saving) return;
    busy = true;
    try {
      const settings = await readSettings(root);
      if (!settings.host)
        throw new Error("Укажите никнейм и адрес сервера в настройках.");

      const origin = updateOrigin(settings);
      report({ phase: "sync", message: "Проверяем сервер обновлений" });
      await getManifest(origin);
      await mkdir(game, { recursive: true });
      const launch = await prepareMinecraft(root, game, settings, report);
      await addMinecraftServer(game, settings);
      report({
        phase: "install",
        message: "Устанавливаем ресурспак и шейдеры",
      });
      await installVisualPacks(game);
      report({ phase: "sync", message: "Получаем список модов" });
      const mods = await getManifest(origin);
      await syncMods(game, origin, mods, report, defaultGraphicsMods(mods));
      report({ phase: "launch", message: "Запускаем Minecraft" });
      await runGame(root, game, launch, () =>
        report({ phase: "running", message: "Minecraft запущен" }),
      );
      report({ phase: "idle", message: "Minecraft закрыт" });
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      await appendFile(
        join(root, "launcher.log"),
        `${new Date().toISOString()} ${cause.stack ?? cause.message}\n`,
        "utf8",
      ).catch(console.error);
      const message =
        progress.phase === "sync"
          ? "Синхронизация не удалась. "
          : progress.phase === "install"
            ? "Установка не удалась. "
            : "";
      report({ phase: "error", message: message + userMessage(cause) });
    } finally {
      busy = false;
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    }
  });

  window.on("close", (event) => {
    if (busy) {
      event.preventDefault();
      window.hide();
    }
  });
}

function userMessage(error: Error) {
  if (error.name === "TimeoutError" || error.message === "fetch failed") {
    return "Проверьте подключение и попробуйте ещё раз.";
  }
  if ("code" in error && error.code !== undefined)
    return "Подробности в launcher.log.";
  return error.message;
}

export const rendererPath = fileURLToPath(rendererUrl);
