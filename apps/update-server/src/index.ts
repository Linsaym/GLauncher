import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createUpdateServer } from "./server.js";

const host = process.env.GLAUNCHER_HOST ?? "127.0.0.1";
const port = Number(process.env.GLAUNCHER_PORT ?? "3000");
const directory = resolve(process.env.GLAUNCHER_MODS_DIR ?? "mods");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("GLAUNCHER_PORT должен быть целым числом от 1 до 65535.");
}

await mkdir(directory, { recursive: true });
createUpdateServer(directory).listen(port, host, () => {
  console.log(`Сервер обновлений: ${host}:${port}\nПапка модов: ${directory}`);
});
