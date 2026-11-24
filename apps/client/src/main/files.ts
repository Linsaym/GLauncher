import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

export const runFile = promisify(execFile);
export type Hash = { sha1: string } | { sha256: string };

export async function statIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function hashFile(path: string, algorithm: "sha1" | "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function atomicWrite(path: string, data: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { flag: "wx" });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function fetchOk(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status} · ${new URL(url).hostname}`);
  }
  return response;
}

export async function download(
  url: string,
  path: string,
  checksum: Hash,
  size?: number,
  redirect: RequestInit["redirect"] = "error",
) {
  const [algorithm, expected] =
    "sha1" in checksum
      ? (["sha1", checksum.sha1] as const)
      : (["sha256", checksum.sha256] as const);
  const before = await statIfExists(path);
  if (
    before?.isFile() &&
    (size === undefined || before.size === size) &&
    (await hashFile(path, algorithm)) === expected
  )
    return;

  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const response = await fetchOk(url, {
      signal: AbortSignal.timeout(300_000),
      redirect,
    });
    if (!response.body) throw new Error("Источник вернул пустой ответ.");
    const hash = createHash(algorithm);
    let bytes = 0;
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (size !== undefined && bytes > size) {
          callback(new Error("Размер файла превышает заявленный."));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await mkdir(dirname(path), { recursive: true });
    await pipeline(
      Readable.fromWeb(response.body),
      verifier,
      createWriteStream(temp, { flags: "wx" }),
    );
    if (
      hash.digest("hex") !== expected ||
      (size !== undefined && bytes !== size)
    ) {
      throw new Error(
        "Размер или контрольная сумма не совпадает: " +
          new URL(url).pathname.split("/").pop(),
      );
    }
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function parallel<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
) {
  let next = 0;
  let failed = false;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (!failed && next < items.length) {
        const item = items[next++];
        try {
          await work(item);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    },
  );
  const results = await Promise.allSettled(workers);
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
