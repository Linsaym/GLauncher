import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { join } from "node:path";
import { app } from "electron";
import { createLauncherWindow } from "../dist/main/window.js";

app.setPath("userData", process.env.GLAUNCHER_TEST_USER_DATA);

async function runSmokeTest() {
  const window = await createLauncherWindow(false);
  const heading = await window.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const observer = new MutationObserver(checkHeading);
      observer.observe(document.body, { childList: true, subtree: true });
      checkHeading();

      function checkHeading() {
        const heading = document.querySelector("main h1");
        if (heading) {
          observer.disconnect();
          resolve(heading.textContent);
        }
      }
    })
  `);
  assert.equal(heading, "GLauncher");
  assert.equal(
    await window.webContents.executeJavaScript("typeof require"),
    "undefined",
  );
  assert.equal(window.isResizable(), false);
  assert.equal(window.isMaximizable(), false);
  assert.equal(window.isFullScreenable(), false);

  const server = createServer((request, response) => {
    response.writeHead(request.url === "/health" ? 204 : 503).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const game = createTcpServer((socket) => {
    const payload = Buffer.from(
      '{"version":{"name":"26.3"},"players":{"online":0}}',
    );
    socket.once("data", () =>
      socket.end(
        Buffer.concat([
          Buffer.from([payload.length + 2, 0, payload.length]),
          payload,
        ]),
      ),
    );
  });
  game.listen(0, "127.0.0.1");
  await once(game, "listening");
  const gamePort = game.address().port;
  const check = (code) => window.webContents.executeJavaScript(code);
  try {
    await check(`
      (async () => {
        const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
        async function waitFor(query) {
          for (let attempt = 0; attempt < 150; attempt++) {
            const element = document.querySelector(query);
            if (element && !element.disabled) return element;
            await pause();
          }
          throw new Error("Element unavailable: " + query);
        }
        (await waitFor(".topbar button")).click();
        (await waitFor("input[name=nickname]")).value = "TestPlayer";
        document.querySelector("input[name=host]").value = "127.0.0.1";
        document.querySelector("input[name=updatePort]").value = "${port}";
        document.querySelector("input[name=gamePort]").value = "${gamePort}";
        if (document.querySelector("input[type=checkbox]")) throw new Error("Unexpected checkbox");
        document.querySelector("form").requestSubmit();
        for (let attempt = 0; attempt < 150; attempt++) {
          if (document.querySelectorAll(".status-dot.online").length === 2) break;
          await pause();
        }
        if (document.querySelectorAll(".status-dot.online").length !== 2) {
          throw new Error("Both server statuses should be online");
        }
        (await waitFor(".play")).click();
        for (let attempt = 0; attempt < 150; attempt++) {
          if (document.querySelector(".launch-status .error")?.textContent.includes("HTTP 503")) return;
          await pause();
        }
        throw new Error("Expected the update service to block launch");
      })()
    `);
    const root = process.env.GLAUNCHER_TEST_USER_DATA;
    const saved = JSON.parse(
      await readFile(join(root, "settings.json"), "utf8"),
    );
    assert.equal(saved.nickname, "TestPlayer");
    assert.equal(saved.updatePort, port);
    assert.equal(saved.gamePort, gamePort);
    assert.equal(Object.hasOwn(saved, "licensed"), false);
    await assert.rejects(stat(join(root, "game")), { code: "ENOENT" });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise((resolve, reject) =>
      game.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

app
  .whenReady()
  .then(runSmokeTest)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
