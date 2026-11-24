import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, download, statIfExists } from "./files.js";
import type { Mod } from "./mods.js";

const resourcePack = "Walnut and Brass - UI.zip";
const shaderPack = "ComplementaryReimagined_r5.9.3.zip";
const assets = new URL("../../assets/", import.meta.url);
const modrinth = "https://cdn.modrinth.com/data";

const graphicsMods = [
  {
    matches:
      /^(?:horizon[-_])?iris(?:[-_](?:neoforge|fork|mc)|[-_]?\d|\.jar$)/i,
    name: "Horizon-Iris-Fork-26.3-1.12.1-r2.jar",
    size: 3216719,
    sha256: "679f99aa779548c6887853f955877e6ca543b0cfafc4e8579a80ca931e01fc89",
    url: "https://mediafilez.forgecdn.net/files/9719/428/Horizon-Iris-Fork-26.3-1.12.1-r2.jar",
  },
  {
    matches: /^sodium(?:[-_](?:neoforge|mc)|[-_]?\d|\.jar$)/i,
    name: "sodium-neoforge-0.9.3-beta.5+mc26.3.jar",
    size: 1211839,
    sha256: "65a087f67e63ffa9e62f7bf483f2865393cbde36cee06fedc07b611032a2514b",
    url: `${modrinth}/AANobbMI/versions/CT6qQx01/sodium-neoforge-0.9.3-beta.5%2Bmc26.3.jar`,
  },
];

export function defaultGraphicsMods(mods: Mod[]) {
  return graphicsMods.filter(
    ({ matches }) => !mods.some(({ name }) => matches.test(name)),
  );
}

async function readOptions(path: string) {
  const stats = await statIfExists(path);
  if (!stats) return "";
  if (!stats.isFile()) throw new Error("Файл настроек игры недоступен.");
  return readFile(path, "utf8");
}

function writeOptions(
  contents: string,
  separator: ":" | "=",
  updates: Record<string, string>,
) {
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const [key, value] of Object.entries(updates)) {
    const prefix = key + separator;
    const index = lines.findIndex((line) => line.startsWith(prefix));
    if (index === -1) lines.push(prefix + value);
    else lines[index] = prefix + value;
  }
  return lines.join(newline) + newline;
}

export async function setVisualDefaults(game: string) {
  const marker = join(game, ".glauncher-visual-defaults");
  if ((await statIfExists(marker))?.isFile()) return;

  const optionsPath = join(game, "options.txt");
  const options = await readOptions(optionsPath);
  const prefix = "resourcePacks:";
  const previous = options
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix));
  const packs: unknown = previous
    ? JSON.parse(previous.slice(prefix.length))
    : [];
  if (!Array.isArray(packs) || packs.some((pack) => typeof pack !== "string")) {
    throw new Error("Не удалось прочитать список ресурспаков в options.txt.");
  }
  const defaults = packs.length ? packs : ["vanilla", "mod_resources"];
  const selected = [...new Set([...defaults, `file/${resourcePack}`])];

  const irisPath = join(game, "config", "iris.properties");
  const iris = await readOptions(irisPath);
  await atomicWrite(
    optionsPath,
    writeOptions(options, ":", {
      lang: "ru_ru",
      resourcePacks: JSON.stringify(selected),
    }),
  );
  await atomicWrite(
    irisPath,
    writeOptions(iris, "=", { enableShaders: "true", shaderPack }),
  );
  await atomicWrite(marker, "1\n");
}

export async function installVisualPacks(game: string) {
  for (const name of ["resourcepacks", "shaderpacks", "config"]) {
    const stats = await statIfExists(join(game, name));
    if (stats && !stats.isDirectory()) {
      throw new Error(`Каталог настроек или паков недоступен: ${name}`);
    }
  }
  const resourcePath = join(game, "resourcepacks", resourcePack);
  const resource = await statIfExists(resourcePath);
  if (!resource) {
    await atomicWrite(
      resourcePath,
      await readFile(new URL(resourcePack, assets)),
    );
  } else if (!resource.isFile()) {
    throw new Error(`Файл ресурспака недоступен: ${resourcePack}`);
  }

  await download(
    `${modrinth}/HVnmMxH1/versions/Bqen1mJX/${shaderPack}`,
    join(game, "shaderpacks", shaderPack),
    { sha1: "838139b54cddb56b2e83cd260d8efd960ac536d6" },
    553397,
  );
  await setVisualDefaults(game);
}
