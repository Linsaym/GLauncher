import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdir,
  mkdtempDisposable,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import nbt from "prismarine-nbt";
import { getManifest, syncMods } from "../dist/main/mods.js";
import { addMinecraftServer } from "../dist/main/servers.js";

test("синхронизация меняет набор модов только после проверки всей сборки", {
  timeout: 10_000,
}, async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "GLauncher моды "),
  );
  const mods = join(directory.path, "mods");
  await mkdir(mods);
  await writeFile(join(mods, "obsolete.jar"), "obsolete");
  await writeFile(join(mods, "changed.jar"), "old");
  await writeFile(join(mods, "same.jar"), "same");
  await writeFile(join(mods, "notes.txt"), "preserved");

  const files = {
    "changed.jar": "new",
    "missing.jar": "added",
    "same.jar": "same",
  };
  const downloads = [];
  let corrupt = true;
  let invalid = false;
  const server = createServer((request, response) => {
    if (request.url === "/manifest") {
      const entries = Object.entries(files).map(([name, data]) => ({
        name,
        size: Buffer.byteLength(data),
        sha256: createHash("sha256").update(data).digest("hex"),
      }));
      if (invalid) entries[0].name = "../escaped.jar";
      response.end(JSON.stringify({ version: 1, mods: entries }));
      return;
    }
    const name = request.url.split("/").at(-1);
    downloads.push(name);
    response.end(corrupt && name === "missing.jar" ? "wrong" : files[name]);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const snapshot = () => getManifest(origin);

  try {
    const manifest = await snapshot();
    await assert.rejects(
      syncMods(directory.path, origin, manifest, () => {}),
      /контрольная сумма/,
    );
    assert.deepEqual(await readdir(mods), [
      "changed.jar",
      "notes.txt",
      "obsolete.jar",
      "same.jar",
    ]);
    assert.equal(await readFile(join(mods, "changed.jar"), "utf8"), "old");

    corrupt = false;
    downloads.length = 0;
    await syncMods(directory.path, origin, manifest, () => {});
    assert.deepEqual(downloads.sort(), ["changed.jar", "missing.jar"]);
    assert.deepEqual(await readdir(mods), [
      "changed.jar",
      "missing.jar",
      "notes.txt",
      "same.jar",
    ]);
    assert.equal(await readFile(join(mods, "changed.jar"), "utf8"), "new");
    assert.equal(await readFile(join(mods, "notes.txt"), "utf8"), "preserved");

    invalid = true;
    await assert.rejects(snapshot(), /некорректное описание/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await assert.rejects(snapshot());
});

test("лаунчер записывает сервер в NBT и обновляет адрес без дубликатов", async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "glauncher-nbt-"),
  );
  const path = join(directory.path, "servers.dat");
  await writeFile(
    path,
    nbt.writeUncompressed({
      name: "",
      type: "compound",
      value: {
        servers: {
          type: "list",
          value: {
            type: "compound",
            value: [
              {
                ip: nbt.string("127.0.0.1:25565"),
                name: nbt.string("Другой сервер"),
              },
            ],
          },
        },
      },
    }),
  );
  const read = async () =>
    nbt.simplify((await nbt.parse(await readFile(path), "big")).parsed).servers;

  await addMinecraftServer(directory.path, {
    host: "127.0.0.1",
    gamePort: 25566,
  });
  assert.equal((await read()).length, 2);
  await addMinecraftServer(directory.path, { host: "::1", gamePort: 25566 });
  await addMinecraftServer(directory.path, { host: "::1", gamePort: 25566 });
  const servers = await read();
  assert.equal(servers.length, 2);
  assert.equal(servers[0].ip, "[::1]:25566");
  assert.equal(servers[1].name, "Другой сервер");
});
