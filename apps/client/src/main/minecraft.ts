import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  MINECRAFT,
  NEOFORGE,
  type Progress,
  type Settings,
} from "./contract.js";
import {
  atomicWrite,
  download,
  fetchOk,
  hashFile,
  parallel,
  runFile,
  statIfExists,
} from "./files.js";

const vanillaUrl =
  "https://piston-meta.mojang.com/v1/packages/ead839cbccf0ddf013c3f935f2840080b5cb0d26/26.3.json";
const vanillaSha1 = "ead839cbccf0ddf013c3f935f2840080b5cb0d26";
const neoId = `neoforge-${NEOFORGE}`;
const neoMaven = "https://maven.neoforged.net/releases/";
const installerUrl =
  neoMaven +
  "net/neoforged/neoforge/" +
  NEOFORGE +
  "/" +
  neoId +
  "-installer.jar";
const installerSha256 =
  "e451494c07ef7ba090f17e3c5debdc318237db29304a40ce10f7433284db6a2a";
const patchedFile =
  "net/neoforged/minecraft-client-patched/" +
  NEOFORGE +
  "/minecraft-client-patched-" +
  NEOFORGE +
  ".jar";
const tar = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "tar.exe",
);

interface Artifact {
  url: string;
  sha1: string;
  size: number;
}

interface Rule {
  action: "allow" | "disallow";
  os?: { name?: string; arch?: string };
  features?: Record<string, boolean>;
}

type Argument = string | { value: string | string[]; rules: Rule[] };

interface Library {
  name: string;
  rules?: Rule[];
  downloads: { artifact: Artifact & { path: string } };
}

interface Version {
  id: string;
  inheritsFrom?: string;
  mainClass: string;
  type: string;
  libraries: Library[];
  arguments: { jvm: Argument[]; game: Argument[] };
}

interface VanillaVersion extends Version {
  downloads: { client: Artifact };
  assetIndex: Artifact & { id: string };
  javaVersion: { majorVersion: number };
  logging: { client: { argument: string; file: Artifact & { id: string } } };
}

function allowed(rules?: Rule[]) {
  if (!rules) return true;
  let result = false;
  for (const rule of rules) {
    const osMatches =
      (!rule.os?.name || rule.os.name === "windows") &&
      (!rule.os?.arch || rule.os.arch === "x86_64" || rule.os.arch === "amd64");
    if (osMatches && !Object.values(rule.features ?? {}).some(Boolean)) {
      result = rule.action === "allow";
    }
  }
  return result;
}

function windowsLibraries(libraries: Library[]) {
  return libraries.filter(
    ({ name, rules }) =>
      allowed(rules) && !name.endsWith(":natives-windows-arm64"),
  );
}

function launchLibraries(neo: Version, vanilla: Version) {
  const libraries = new Map<string, Library>();
  for (const library of windowsLibraries([
    ...neo.libraries,
    ...vanilla.libraries,
  ])) {
    const [group, name, , classifier = ""] = library.name.split(":");
    const key = [group, name, classifier].join(":");
    if (!libraries.has(key)) libraries.set(key, library);
  }
  return [...libraries.values()];
}

export function javaEnvironment(root: string) {
  const env = { ...process.env, APPDATA: root, LOCALAPPDATA: root };
  for (const name of [
    "JDK_JAVA_OPTIONS",
    "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS",
    "CLASSPATH",
  ]) {
    delete env[name as keyof typeof env];
  }
  return env;
}

async function installJava(root: string) {
  const target = join(root, "runtime", "java-25-x64");
  const java = join(target, "bin", "java.exe");
  if ((await statIfExists(java))?.isFile()) return java;

  const url =
    "https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse";
  const response = await fetchOk(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const releases = (await response.json()) as Array<{
    binary: { package: { link: string; checksum: string; size: number } };
  }>;
  const pkg = releases[0]?.binary.package;
  if (
    !pkg?.link.startsWith(
      "https://github.com/adoptium/temurin25-binaries/releases/download/",
    ) ||
    !/^[a-f0-9]{64}$/.test(pkg.checksum) ||
    !Number.isSafeInteger(pkg.size) ||
    pkg.size <= 0
  ) {
    throw new Error("Adoptium не вернул архив Java 25 для Windows x64.");
  }
  const cache = join(root, "cache");
  const zip = join(cache, "temurin-25.zip");
  await download(pkg.link, zip, { sha256: pkg.checksum }, pkg.size, "follow");
  const scratch = await mkdtemp(join(cache, "java-"));
  try {
    await runFile(tar, ["-xf", zip, "-C", scratch], {
      windowsHide: true,
      timeout: 120_000,
    });
    const [entry, ...rest] = await readdir(scratch);
    const extracted = join(scratch, entry ?? "");
    if (
      !entry ||
      rest.length ||
      !(await statIfExists(join(extracted, "bin", "java.exe")))?.isFile()
    ) {
      throw new Error("Архив Java имеет неожиданную структуру.");
    }
    await runFile(join(extracted, "bin", "java.exe"), ["-version"], {
      env: javaEnvironment(root),
      windowsHide: true,
      timeout: 15_000,
    });
    await mkdir(join(root, "runtime"), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(extracted, target);
    await rm(zip, { force: true });
    return java;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function expand(argumentsList: Argument[], variables: Record<string, string>) {
  return argumentsList
    .flatMap((arg) =>
      typeof arg === "string" ? [arg] : allowed(arg.rules) ? arg.value : [],
    )
    .map((arg) =>
      arg.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        if (!(name in variables))
          throw new Error(`Неизвестный параметр запуска: ${name}`);
        return variables[name];
      }),
    );
}

function offlineUuid(nickname: string) {
  const hash = createHash("md5").update(`OfflinePlayer:${nickname}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return hash.toString("hex");
}

async function patchMinecraft(
  root: string,
  java: string,
  minecraftJar: string,
  installer: string,
  libraries: string,
) {
  const patched = join(libraries, patchedFile);
  const stamp = `${patched}.sha256`;
  if (
    (await statIfExists(stamp))?.isFile() &&
    (await statIfExists(patched))?.isFile() &&
    (await readFile(stamp, "utf8")) === (await hashFile(patched, "sha256"))
  )
    return;

  const scratch = await mkdtemp(join(root, "cache", "neoforge-"));
  const output = join(scratch, "client.jar");
  try {
    await runFile(tar, ["-xf", installer, "-C", scratch, "data/client.lzma"], {
      windowsHide: true,
      timeout: 30_000,
    });
    await runFile(
      java,
      [
        `-Duser.home=${root}`,
        `-Djava.io.tmpdir=${scratch}`,
        "-jar",
        join(
          libraries,
          "net",
          "neoforged",
          "installertools",
          "installertools",
          "4.0.17",
          "installertools-4.0.17-fatjar.jar",
        ),
        "--task",
        "PROCESS_MINECRAFT_JAR",
        "--no-mod-manifest",
        "--input",
        minecraftJar,
        "--output",
        output,
        "--extract-libraries-to",
        libraries,
        "--apply-patches",
        join(scratch, "data", "client.lzma"),
      ],
      {
        cwd: scratch,
        env: javaEnvironment(root),
        windowsHide: true,
        timeout: 180_000,
      },
    );
    const hash = await hashFile(output, "sha256");
    await mkdir(join(libraries, patchedFile, ".."), { recursive: true });
    await rename(output, patched);
    await atomicWrite(stamp, hash);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function prepareMinecraft(
  root: string,
  game: string,
  settings: Settings,
  progress: (value: Progress) => void,
) {
  if (
    process.platform !== "win32" ||
    (process.arch !== "x64" && process.arch !== "arm64")
  ) {
    throw new Error("GLauncher требует Windows с поддержкой приложений x64.");
  }
  const report = (message: string, fraction?: number) =>
    progress({ phase: "install", message, fraction });
  const cache = join(root, "cache");
  const libraries = join(game, "libraries");
  const assets = join(game, "assets");
  const location = join(game, "versions", MINECRAFT);
  const vanillaPath = join(location, `${MINECRAFT}.json`);
  const installer = join(cache, `${neoId}-installer.jar`);

  report("Подготавливаем Java 25");
  const java = await installJava(root);
  report("Получаем данные Minecraft и NeoForge", 0.06);
  await Promise.all([
    download(vanillaUrl, vanillaPath, { sha1: vanillaSha1 }),
    download(installerUrl, installer, { sha256: installerSha256 }),
  ]);
  const vanilla = JSON.parse(
    await readFile(vanillaPath, "utf8"),
  ) as VanillaVersion;
  const { stdout: version } = await runFile(
    tar,
    ["-xOf", installer, "version.json"],
    {
      windowsHide: true,
      timeout: 30_000,
    },
  );
  const { stdout: profile } = await runFile(
    tar,
    ["-xOf", installer, "install_profile.json"],
    {
      windowsHide: true,
      timeout: 30_000,
    },
  );
  const neo = JSON.parse(version) as Version;
  const profileLibraries = (JSON.parse(profile) as { libraries: Library[] })
    .libraries;
  if (
    vanilla.id !== MINECRAFT ||
    vanilla.javaVersion.majorVersion !== 25 ||
    neo.id !== neoId ||
    neo.inheritsFrom !== MINECRAFT
  ) {
    throw new Error("Метаданные Minecraft и NeoForge несовместимы.");
  }

  const minecraftJar = join(location, `${MINECRAFT}.jar`);
  const index = join(assets, "indexes", `${vanilla.assetIndex.id}.json`);
  const logging = join(assets, "log_configs", vanilla.logging.client.file.id);
  const classpathLibraries = launchLibraries(neo, vanilla);
  const artifacts = new Map<string, Artifact>([
    [minecraftJar, vanilla.downloads.client],
    [index, vanilla.assetIndex],
    [logging, vanilla.logging.client.file],
  ]);
  for (const library of [
    ...classpathLibraries,
    ...windowsLibraries(profileLibraries),
  ]) {
    const artifact = library.downloads.artifact;
    artifacts.set(join(libraries, artifact.path), artifact);
  }

  let downloaded = 0;
  await parallel([...artifacts], 8, async ([destination, artifact]) => {
    await download(artifact.url, destination, artifact, artifact.size);
    report(
      "Устанавливаем Minecraft и библиотеки",
      0.1 + (0.35 * ++downloaded) / artifacts.size,
    );
  });

  report("Устанавливаем NeoForge", 0.45);
  await patchMinecraft(root, java, minecraftJar, installer, libraries);

  const assetIndex = JSON.parse(await readFile(index, "utf8")) as {
    objects: Record<string, { hash: string; size: number }>;
  };
  const objects = [
    ...new Map(
      Object.values(assetIndex.objects).map((asset) => [asset.hash, asset]),
    ).values(),
  ];
  let ready = 0;
  await parallel(objects, 12, async ({ hash, size }) => {
    const prefix = hash.slice(0, 2);
    const asset = join(assets, "objects", prefix, hash);
    const present = await statIfExists(asset);
    if (!present?.isFile() || present.size !== size) {
      await download(
        `https://resources.download.minecraft.net/${prefix}/${hash}`,
        asset,
        { sha1: hash },
        size,
      );
    }
    ready++;
    if (ready % 25 === 0 || ready === objects.length) {
      report("Проверяем игровые ресурсы", 0.5 + (0.5 * ready) / objects.length);
    }
  });

  const natives = join(game, "natives");
  await mkdir(natives, { recursive: true });
  const variables = {
    auth_player_name: settings.nickname,
    auth_uuid: offlineUuid(settings.nickname),
    auth_access_token: "0",
    clientid: "",
    auth_xuid: "",
    version_name: neo.id,
    version_type: neo.type,
    game_directory: game,
    assets_root: assets,
    assets_index_name: vanilla.assetIndex.id,
    natives_directory: natives,
    library_directory: libraries,
    launcher_name: "GLauncher",
    launcher_version: "0.1.0",
    classpath: [
      ...classpathLibraries.map((library) =>
        join(libraries, library.downloads.artifact.path),
      ),
      minecraftJar,
    ].join(delimiter),
  };

  return {
    java,
    args: [
      `-Duser.home=${root}`,
      "-Xms1G",
      `-Xmx${settings.memoryGb}G`,
      ...expand([...vanilla.arguments.jvm, ...neo.arguments.jvm], variables),
      expand([vanilla.logging.client.argument], { path: logging })[0],
      neo.mainClass,
      ...expand([...vanilla.arguments.game, ...neo.arguments.game], variables),
    ],
  };
}
