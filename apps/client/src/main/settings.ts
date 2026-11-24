import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import type { Settings } from "./contract.js";
import { atomicWrite } from "./files.js";

const defaults: Settings = {
  nickname: "",
  host: "",
  updatePort: 3000,
  gamePort: 25565,
  memoryGb: 4,
};

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object")
    throw new Error("Некорректные настройки.");
  const input = value as Partial<Settings>;
  const nickname =
    typeof input.nickname === "string" ? input.nickname.trim() : "";
  const host = typeof input.host === "string" ? input.host.trim() : "";
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(nickname)) {
    throw new Error(
      "Никнейм должен содержать 3–16 латинских букв, цифр или подчёркиваний.",
    );
  }
  if (!isIP(host) || host.includes("%"))
    throw new Error("Укажите IPv4- или IPv6-адрес сервера.");
  const { updatePort, gamePort, memoryGb } = input;
  if (!validPort(updatePort) || !validPort(gamePort)) {
    throw new Error("Порты должны быть целыми числами от 1 до 65535.");
  }
  if (
    typeof memoryGb !== "number" ||
    !Number.isInteger(memoryGb) ||
    memoryGb < 2 ||
    memoryGb > 64
  ) {
    throw new Error("Укажите от 2 до 64 ГБ оперативной памяти.");
  }
  return { nickname, host, updatePort, gamePort, memoryGb };
}

function validPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

export async function readSettings(root: string): Promise<Settings> {
  try {
    return validateSettings(
      JSON.parse(await readFile(join(root, "settings.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...defaults };
    throw new Error("Файл настроек повреждён. Сохраните настройки заново.", {
      cause: error,
    });
  }
}

export async function saveSettings(root: string, value: unknown) {
  const settings = validateSettings(value);
  await atomicWrite(
    join(root, "settings.json"),
    JSON.stringify(settings, null, 2),
  );
  return settings;
}

export function address(host: string, port: number) {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}
