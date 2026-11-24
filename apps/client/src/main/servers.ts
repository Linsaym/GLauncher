import { readFile } from "node:fs/promises";
import { join } from "node:path";
import nbt, {
  type Compound,
  type List,
  type NBT,
  type TagType,
} from "prismarine-nbt";
import type { Settings } from "./contract.js";
import { atomicWrite, statIfExists } from "./files.js";
import { address } from "./settings.js";

const serverName = "Приватный сервер GLauncher";

export async function addMinecraftServer(game: string, settings: Settings) {
  const path = join(game, "servers.dat");
  const ip = address(settings.host, settings.gamePort);
  const document: NBT = (await statIfExists(path))
    ? (await nbt.parse(await readFile(path), "big")).parsed
    : { type: "compound", name: "", value: {} };
  const tag = document.value.servers;
  let servers: Compound["value"][] = [];
  if (tag?.type === "list" && tag.value.type === "compound") {
    servers = (tag as List<TagType.Compound>).value.value;
  } else if (tag && (tag.type !== "list" || tag.value.value.length > 0)) {
    throw new Error("Не удалось прочитать список серверов Minecraft.");
  }

  if (
    servers.some(
      (entry) => entry.ip?.type === "string" && entry.ip.value === ip,
    )
  )
    return;
  const managed = servers.find(
    (entry) => entry.name?.type === "string" && entry.name.value === serverName,
  );
  if (managed) managed.ip = nbt.string(ip);
  else servers.unshift({ name: nbt.string(serverName), ip: nbt.string(ip) });

  document.value.servers = {
    type: "list",
    value: { type: "compound", value: servers },
  };
  await atomicWrite(path, nbt.writeUncompressed(document, "big"));
}
