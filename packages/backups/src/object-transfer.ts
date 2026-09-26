import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_OBJECT_BYTES = 512 * 1024 * 1024;

export interface ObjectReceipt {
  digest: string;
  size: number;
}

export interface ReplayableObject {
  readonly receipt: ObjectReceipt;
  open(): Readable;
  dispose(): Promise<void>;
}

export interface StageOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  temporaryRoot?: string;
  maxBytes?: number;
}

export function receipt(bytes: Uint8Array): ObjectReceipt {
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
  };
}

export function bufferObject(bytes: Uint8Array): ReplayableObject {
  const stored = Buffer.from(bytes),
    expected = receipt(stored);
  return {
    receipt: expected,
    open: () => Readable.from([stored]),
    async dispose() {},
  };
}

export async function stageReadable(
  body: Readable,
  contentLength: number,
  options: StageOptions = {},
): Promise<ReplayableObject & { path: string }> {
  const maximum = options.maxBytes ?? MAX_OBJECT_BYTES;
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > maximum
  )
    throw new Error("backup.object_invalid");

  const directory = await mkdtemp(
      join(options.temporaryRoot ?? tmpdir(), "cloud-backup-object-"),
    ),
    path = join(directory, "object"),
    hash = createHash("sha256");
  let size = 0,
    disposed = false;
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 30000),
    signal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline,
    meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > contentLength || size > maximum) {
          callback(new Error("backup.object_invalid"));
          return;
        }
        hash.update(bytes);
        callback(null, bytes);
      },
    });
  try {
    await pipeline(body, meter, createWriteStream(path, { flags: "wx", mode: 0o600 }), {
      signal,
    });
    if (size !== contentLength) throw new Error("backup.object_invalid");
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (signal.aborted) throw new Error("backup.cancelled");
    throw error;
  }
  return {
    path,
    receipt: { digest: hash.digest("hex"), size },
    open: () => createReadStream(path),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
