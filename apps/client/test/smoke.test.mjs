import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

test("Electron loads the React bundle in an isolated renderer", (t) => {
  const userData = mkdtempDisposableSync(join(tmpdir(), "glauncher-electron-"));
  t.after(() => userData.remove());

  const smoke = fileURLToPath(
    new URL("../test-support/electron-smoke.mjs", import.meta.url),
  );
  const result = spawnSync(electronPath, [smoke], {
    env: { ...process.env, GLAUNCHER_TEST_USER_DATA: userData.path },
    stdio: "inherit",
    timeout: 45_000,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }
  assert.equal(
    result.status,
    0,
    `Electron smoke test exited with ${result.status}`,
  );
});
