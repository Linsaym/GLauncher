import { createConnection } from "node:net";
import type { Settings, Status } from "./contract.js";
import { updateOrigin } from "./mods.js";

function varInt(value: number) {
  const bytes: number[] = [];
  do {
    const lower = value & 0x7f;
    value >>>= 7;
    bytes.push(value ? lower | 0x80 : lower);
  } while (value);
  return Buffer.from(bytes);
}

function readVarInt(buffer: Buffer, offset: number) {
  let result = 0;
  for (let index = 0; index < 5 && index + offset < buffer.length; index++) {
    const byte = buffer[index + offset];
    result |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return { value: result, next: index + offset + 1 };
  }
  return undefined;
}

function minecraftStatus(host: string, port: number): Promise<boolean> {
  const hostname = Buffer.from(host, "utf8");
  const portBytes = Buffer.alloc(2);
  portBytes.writeUInt16BE(port);
  const packet = Buffer.concat([
    varInt(0),
    varInt(-1),
    varInt(hostname.length),
    hostname,
    portBytes,
    varInt(1),
  ]);

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let received: Buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(false), 3500);
    function finish(status: boolean) {
      clearTimeout(timer);
      socket.destroy();
      resolve(status);
    }

    socket.once("connect", () =>
      socket.write(
        Buffer.concat([varInt(packet.length), packet, Buffer.from([1, 0])]),
      ),
    );
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      if (received.length > 65_536) return finish(false);
      const length = readVarInt(received, 0);
      if (!length) return;
      if (length.value < 3 || length.value > 65_530) return finish(false);
      const end = length.next + length.value;
      if (received.length < end) return;
      const id = readVarInt(received, length.next);
      const jsonLength = id && readVarInt(received, id.next);
      if (
        id?.value !== 0 ||
        !jsonLength ||
        jsonLength.value < 2 ||
        jsonLength.next + jsonLength.value !== end
      )
        return finish(false);
      try {
        const value = JSON.parse(
          received.toString("utf8", jsonLength.next, end),
        );
        finish(Boolean(value?.version && value?.players));
      } catch {
        finish(false);
      }
    });
  });
}

export async function getStatus(settings: Settings): Promise<Status | null> {
  if (!settings.host) return null;
  const [minecraft, updates] = await Promise.all([
    minecraftStatus(settings.host, settings.gamePort),
    fetch(`${updateOrigin(settings)}/health`, {
      signal: AbortSignal.timeout(3500),
      redirect: "error",
      method: "HEAD",
    }).then(
      (response) => response.status === 204,
      () => false,
    ),
  ]);
  return { minecraft, updates };
}
