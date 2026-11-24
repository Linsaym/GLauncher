import { copyFile, cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Progress, Settings } from "./contract.js";
import {
  download,
  fetchOk,
  hashFile,
  parallel,
  statIfExists,
} from "./files.js";
import { address } from "./settings.js";

export interface Mod {
  name: string;
  size: number;
  sha256: string;
}

export function updateOrigin(settings: Settings) {
  return `http://${address(settings.host, settings.updatePort)}`;
}

function isModName(name: string) {
  return (
    /^[^<>:"/\\|?*]{1,200}\.jar$/iu.test(name) &&
    !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\./iu.test(name)
  );
}

export async function getManifest(origin: string): Promise<Mod[]> {
  const response = await fetchOk(`${origin}/manifest`, {
    signal: AbortSignal.timeout(45_000),
    redirect: "error",
    cache: "no-store",
  });
  const data = (await response.json()) as { version?: unknown; mods?: unknown };
  if (
    data?.version !== 1 ||
    !Array.isArray(data.mods) ||
    data.mods.length > 10_000
  ) {
    throw new Error("Сервер прислал неподдерживаемый манифест модов.");
  }
  const names = new Set<string>();
  return data.mods
    .map((entry: Partial<Mod> | null) => {
      const { name, size, sha256 } = entry ?? {};
      if (
        typeof name !== "string" ||
        !isModName(name) ||
        names.has(name.toLowerCase()) ||
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        typeof sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(sha256)
      ) {
        throw new Error("Сервер прислал некорректное описание мода.");
      }
      names.add(name.toLowerCase());
      return { name, size, sha256 };
    })
    .sort((a, b) => (a.name < b.name ? -1 : Number(a.name !== b.name)));
}

export async function syncMods(
  game: string,
  origin: string,
  published: Mod[],
  progress: (value: Progress) => void,
  clientMods: (Mod & { url: string })[] = [],
) {
  const mods = [
    ...published.map((mod) => ({
      ...mod,
      url: `${origin}/mods/${encodeURIComponent(mod.name)}`,
    })),
    ...clientMods,
  ];
  const active = join(game, "mods");
  const stage = join(game, ".glauncher-mods-stage");
  const backup = join(game, ".glauncher-mods-backup");
  await mkdir(game, { recursive: true });

  const saved = await statIfExists(backup);
  const current = await statIfExists(active);
  if ((saved && !saved.isDirectory()) || (current && !current.isDirectory())) {
    throw new Error("Каталог модов недоступен или является ссылкой.");
  }
  if (saved && !current) await rename(backup, active);
  else if (saved) await rm(backup, { recursive: true });
  await rm(stage, { force: true, recursive: true });

  const existing = (await statIfExists(active))
    ? await readdir(active, { withFileTypes: true })
    : [];
  const jars = new Map(
    existing
      .filter(
        (entry) =>
          !entry.isDirectory() && entry.name.toLowerCase().endsWith(".jar"),
      )
      .map((entry) => [entry.name, entry]),
  );
  const matching = new Set<string>();
  let checked = 0;
  const report = (message: string, fraction: number) =>
    progress({ phase: "sync", message, fraction });
  report("Проверяем установленные моды", 0);
  await parallel(mods, 6, async (mod) => {
    if (jars.get(mod.name)?.isFile()) {
      const path = join(active, mod.name);
      const stats = await statIfExists(path);
      if (
        stats?.isFile() &&
        stats.size === mod.size &&
        (await hashFile(path, "sha256")) === mod.sha256
      ) {
        matching.add(mod.name);
      }
    }
    report("Проверяем установленные моды", (0.35 * ++checked) / mods.length);
  });

  const changed =
    !(await statIfExists(active)) ||
    matching.size !== mods.length ||
    jars.size !== mods.length;
  try {
    if (changed) {
      await mkdir(stage);
      for (const { name } of existing) {
        if (!jars.has(name)) {
          await cp(join(active, name), join(stage, name), {
            recursive: true,
            verbatimSymlinks: true,
          });
        }
      }
      let prepared = 0;
      await parallel(mods, 4, async (mod) => {
        const destination = join(stage, mod.name);
        if (matching.has(mod.name)) {
          await copyFile(join(active, mod.name), destination);
          if ((await hashFile(destination, "sha256")) !== mod.sha256) {
            throw new Error(
              `Локальный файл изменился при синхронизации: ${mod.name}`,
            );
          }
        } else {
          await download(mod.url, destination, mod, mod.size);
        }
        report("Синхронизируем моды", 0.35 + (0.6 * ++prepared) / mods.length);
      });
    }

    report("Подтверждаем список модов", 0.97);
    if (
      JSON.stringify(await getManifest(origin)) !== JSON.stringify(published)
    ) {
      throw new Error("Список модов изменился. Нажмите «Играть» ещё раз.");
    }
    if (changed) {
      const hadActive = Boolean(await statIfExists(active));
      if (hadActive) await rename(active, backup);
      try {
        await rename(stage, active);
      } catch (error) {
        if (hadActive) await rename(backup, active);
        throw error;
      }
      await rm(backup, { force: true, recursive: true });
    }
    report("Моды синхронизированы", 1);
  } finally {
    await rm(stage, { force: true, recursive: true });
  }
}
