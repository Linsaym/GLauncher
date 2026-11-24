import assert from "node:assert/strict";
import {
  mkdir,
  mkdtempDisposable,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateSettings } from "../dist/main/settings.js";
import {
  defaultGraphicsMods,
  setVisualDefaults,
} from "../dist/main/visuals.js";

test("русский язык и паки применяются один раз с сохранением прочих настроек", async () => {
  await using directory = await mkdtempDisposable(
    join(tmpdir(), "GLauncher паки "),
  );
  const options = join(directory.path, "options.txt");
  const config = join(directory.path, "config");
  const iris = join(config, "iris.properties");
  await mkdir(config);
  await writeFile(
    options,
    'lang:en_us\r\nresourcePacks:["vanilla","file/My Pack.zip"]\r\nrenderDistance:12\r\n',
  );
  await writeFile(iris, "maxShadowRenderDistance=16\nenableShaders=false\n");
  await setVisualDefaults(directory.path);
  assert.equal(
    await readFile(options, "utf8"),
    'lang:ru_ru\r\nresourcePacks:["vanilla","file/My Pack.zip","file/Walnut and Brass - UI.zip"]\r\nrenderDistance:12\r\n',
  );
  assert.equal(
    await readFile(iris, "utf8"),
    "maxShadowRenderDistance=16\nenableShaders=true\nshaderPack=ComplementaryReimagined_r5.9.3.zip\n",
  );

  await writeFile(options, "lang:de_de\n");
  await writeFile(iris, "enableShaders=false\n");
  await setVisualDefaults(directory.path);
  assert.equal(await readFile(options, "utf8"), "lang:de_de\n");
  assert.equal(await readFile(iris, "utf8"), "enableShaders=false\n");
});

test("JAR от сервера заменяет только соответствующий стандартный графический мод", () => {
  assert.equal(defaultGraphicsMods([]).length, 2);
  const fallback = defaultGraphicsMods([
    { name: "Horizon-Iris-Fork-26.3-1.12.1-r2.jar" },
    { name: "sodium-extra-example.jar" },
  ]);
  assert.deepEqual(
    fallback.map(({ name }) => name),
    ["sodium-neoforge-0.9.3-beta.5+mc26.3.jar"],
  );
  assert.equal(
    defaultGraphicsMods([{ name: "iris.jar" }, { name: "sodium.jar" }]).length,
    0,
  );
});

test("настройки прежних версий открываются независимо от значения снятой галочки", () => {
  const settings = {
    nickname: "TestPlayer",
    host: "127.0.0.1",
    updatePort: 3000,
    gamePort: 25565,
    memoryGb: 4,
  };
  assert.deepEqual(
    validateSettings({ ...settings, licensed: false }),
    settings,
  );
  assert.deepEqual(validateSettings(settings), settings);
});
