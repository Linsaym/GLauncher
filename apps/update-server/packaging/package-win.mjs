import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  cp,
  mkdir,
  mkdtempDisposable,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.platform !== "win32") {
  throw new Error("Собирайте архив сервера на Windows.");
}
const tar = promisify(execFile);
const version = process.versions.node;
const distribution = `node-v${version}-win-x64`;
const nodeUrl = `https://nodejs.org/dist/v${version}`;
const archiveName = `${distribution}.zip`;

async function get(file) {
  const response = await fetch(`${nodeUrl}/${file}`, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok)
    throw new Error(`Загрузка Node.js: HTTP ${response.status}`);
  return response;
}

const listing = await (await get("SHASUMS256.txt")).text();
const entry = listing
  .split("\n")
  .find((line) => line.trimEnd().endsWith(`  ${archiveName}`));
const checksum = entry?.split(" ", 1)[0];
if (!checksum) throw new Error(`Контрольная сумма ${archiveName} отсутствует.`);

const zipped = Buffer.from(await (await get(archiveName)).arrayBuffer());
if (createHash("sha256").update(zipped).digest("hex") !== checksum) {
  throw new Error("Контрольная сумма Node.js не совпадает.");
}

await using work = await mkdtempDisposable(
  join(tmpdir(), "glauncher-server-package-"),
);
const source = join(work.path, archiveName);
const stage = join(work.path, "stage");
const runtime = join(stage, "runtime");
const server = join(stage, "server");
await mkdir(runtime, { recursive: true });
await writeFile(source, zipped);
await tar(
  "tar.exe",
  [
    "-xf",
    source,
    "-C",
    work.path,
    `${distribution}/node.exe`,
    `${distribution}/LICENSE`,
  ],
  { windowsHide: true },
);
await cp(new URL("../dist/", import.meta.url), server, { recursive: true });
await Promise.all([
  copyFile(
    join(work.path, distribution, "node.exe"),
    join(runtime, "node.exe"),
  ),
  copyFile(join(work.path, distribution, "LICENSE"), join(runtime, "LICENSE")),
  writeFile(join(server, "package.json"), '{ "type": "module" }\n'),
  copyFile(
    new URL("./start-server.bat", import.meta.url),
    join(stage, "start-server.bat"),
  ),
  copyFile(new URL("./README.txt", import.meta.url), join(stage, "README.txt")),
]);

const release = fileURLToPath(new URL("../release/", import.meta.url));
await mkdir(release, { recursive: true });
const archive = join(release, "GLauncher-Server.zip");
await tar("tar.exe", ["-a", "-cf", archive, "-C", stage, "."], {
  windowsHide: true,
});
console.log(archive);
