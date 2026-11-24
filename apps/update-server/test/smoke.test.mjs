import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtempDisposable, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUpdateServer } from "../dist/server.js";

test("сервер публикует актуальные JAR-файлы и контрольные суммы", {
  timeout: 10_000,
}, async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "glauncher-updates-"),
  );
  const server = createUpdateServer(directory.path);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  const get = (path, options) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      signal: AbortSignal.timeout(5000),
    });
  const expected = (name, data) => ({
    name,
    size: Buffer.byteLength(data),
    sha256: createHash("sha256").update(data).digest("hex"),
  });

  try {
    const name = "Пример #1.jar";
    const path = join(directory.path, name);
    await writeFile(path, "one");
    await writeFile(join(directory.path, "notes.txt"), "ignored");
    await mkdir(join(directory.path, "folder.jar"));

    const health = await get("/health", { method: "HEAD" });
    assert.equal(health.status, 204);
    const manifest = await get("/manifest");
    assert.equal(manifest.headers.get("cache-control"), "no-store");
    assert.deepEqual(await manifest.json(), {
      version: 1,
      mods: [expected(name, "one")],
    });
    const file = await get(`/mods/${encodeURIComponent(name)}`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "one");
    assert.equal((await get("/mods/%2e%2e%2fprivate.jar")).status, 404);
    assert.equal((await get("/mods/notes.txt")).status, 404);
    assert.equal((await get("/missing")).status, 404);
    assert.equal((await get("/manifest", { method: "POST" })).status, 405);

    await writeFile(path, "two");
    assert.deepEqual((await (await get("/manifest")).json()).mods, [
      expected(name, "two"),
    ]);
    await rm(path);
    assert.deepEqual((await (await get("/manifest")).json()).mods, []);
    assert.equal((await get(`/mods/${encodeURIComponent(name)}`)).status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
