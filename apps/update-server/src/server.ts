import { createHash } from "node:crypto";
import { lstat, open, readdir } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

function isModName(name: string): boolean {
  return (
    /^[^<>:"/\\|?*]{1,200}\.jar$/iu.test(name) &&
    !Array.from(name).some((character) => character.charCodeAt(0) < 32) &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\./iu.test(name)
  );
}

async function manifest(directory: string) {
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"),
    )
    .map(({ name }) => name)
    .sort();
  const seen = new Set<string>();
  const mods = [];
  for (const name of files) {
    const key = name.toLowerCase();
    if (!isModName(name) || seen.has(key)) {
      throw new Error(`Некорректное или повторяющееся имя мода: ${name}`);
    }
    seen.add(key);
    const file = await open(join(directory, name));
    try {
      const before = await file.stat();
      if (!before.isFile()) throw new Error(`Файл мода изменился: ${name}`);
      const hash = createHash("sha256");
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        hash.update(chunk);
      }
      const after = await lstat(join(directory, name));
      if (
        before.ino !== after.ino ||
        before.dev !== after.dev ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        !after.isFile()
      ) {
        throw new Error(`Файл мода изменился: ${name}`);
      }
      mods.push({ name, size: before.size, sha256: hash.digest("hex") });
    } finally {
      await file.close();
    }
  }
  return { version: 1, mods };
}

async function respond(
  directory: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (request.url === "/health") {
    const stats = await lstat(directory);
    response.writeHead(stats.isDirectory() ? 204 : 503).end();
    return;
  }
  if (request.url === "/manifest") {
    if (!(await lstat(directory)).isDirectory()) {
      response.writeHead(503).end();
      return;
    }
    const body = JSON.stringify(await manifest(directory));
    response
      .writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
      })
      .end(request.method === "HEAD" ? undefined : body);
    return;
  }
  if (!request.url?.startsWith("/mods/")) {
    response.writeHead(404).end();
    return;
  }

  let name: string;
  try {
    name = decodeURIComponent(request.url.slice("/mods/".length));
  } catch {
    response.writeHead(400).end();
    return;
  }
  if (!isModName(name)) {
    response.writeHead(404).end();
    return;
  }
  if (!(await lstat(directory)).isDirectory()) {
    response.writeHead(503).end();
    return;
  }
  const path = join(directory, name);
  const stats = await lstat(path);
  if (!stats.isFile()) {
    response.writeHead(404).end();
    return;
  }
  const file = await open(path);
  try {
    const current = await file.stat();
    if (
      !current.isFile() ||
      current.ino !== stats.ino ||
      current.dev !== stats.dev
    ) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/java-archive",
      "Content-Length": current.size,
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      await pipeline(file.createReadStream(), response);
    }
  } finally {
    await file.close();
  }
}

export function createUpdateServer(directory: string) {
  return createServer((request, response) => {
    respond(directory, request, response).catch(
      (error: NodeJS.ErrnoException) => {
        if (response.headersSent || response.destroyed) {
          response.destroy();
          return;
        }
        const missingMod =
          request.url?.startsWith("/mods/") && error.code === "ENOENT";
        if (!missingMod) console.error(error.message);
        response.writeHead(missingMod ? 404 : 503).end();
      },
    );
  });
}
