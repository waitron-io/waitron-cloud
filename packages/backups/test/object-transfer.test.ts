import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import {
  MAX_OBJECT_BYTES,
  bufferObject,
  stageReadable,
} from "../src/object-transfer.ts";

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "cloud-object-transfer-test-"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function digest(stream: Readable) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { digest: hash.digest("hex"), size };
}

function repeated(byte: number, size: number, pause = 0) {
  return Readable.from(
    (async function* () {
      let remaining = size;
      while (remaining > 0) {
        if (pause) await delay(pause);
        const length = Math.min(64 * 1024, remaining);
        remaining -= length;
        yield Buffer.alloc(length, byte);
      }
    })(),
  );
}

test("staging hashes a large generated body with bounded chunks and reopens it from byte zero", async () => {
  const size = 4 * 1024 * 1024;
  const before = process.memoryUsage().arrayBuffers;
  let peak = before;
  const body = Readable.from(
    (async function* () {
      let remaining = size;
      while (remaining > 0) {
        const length = Math.min(64 * 1024, remaining);
        remaining -= length;
        yield Buffer.alloc(length, 0x61);
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      }
    })(),
  );
  const staged = await stageReadable(body, size, { temporaryRoot: root });
  try {
    assert.deepEqual(staged.receipt, {
      digest: "299285fc41a44cdb038b9fdaf494c76ca9d0c866672b2b266c1a0c17dda60a05",
      size,
    });
    assert.deepEqual(await digest(staged.open()), staged.receipt);
    assert.deepEqual(await digest(staged.open()), staged.receipt);
    assert.equal((await stat(staged.path)).mode & 0o777, 0o600);
    assert(peak - before < 8 * 1024 * 1024, `array buffer growth was ${peak - before}`);
  } finally {
    await staged.dispose();
  }
  await staged.dispose();
  assert.deepEqual(await readdir(root), []);
});

test("buffer objects preserve an immutable receipt and replay their bytes", async () => {
  const source = Buffer.from("fixed archive bytes");
  const object = bufferObject(source);
  source.fill(0);
  assert.deepEqual(await digest(object.open()), {
    digest: "63c25986d235cd49f7d327d3b59d65a73ea1ad07c4b688d0bef20f5ec85bd525",
    size: 19,
  });
  assert.deepEqual(await digest(object.open()), object.receipt);
  await object.dispose();
});

test("staging rejects a truncated body and removes its partial file", async () => {
  await assert.rejects(
    stageReadable(Readable.from([Buffer.from("short")]), 10, {
      temporaryRoot: root,
    }),
    /^Error: backup.object_invalid$/,
  );
  assert.deepEqual(await readdir(root), []);
});

test("staging refuses an advertised object above the unchanged 512 MiB ceiling", async () => {
  await assert.rejects(
    stageReadable(Readable.from([]), MAX_OBJECT_BYTES + 1, {
      temporaryRoot: root,
    }),
    /^Error: backup.object_invalid$/,
  );
  assert.deepEqual(await readdir(root), []);
});

test("invalid advertised lengths close the unread provider body", async () => {
  const body = Readable.from([Buffer.from("unread")]);
  await assert.rejects(
    stageReadable(body, Number.NaN, { temporaryRoot: root }),
    /^Error: backup.object_invalid$/,
  );
  assert.equal(body.destroyed, true);
  assert.deepEqual(await readdir(root), []);
});

test("caller cancellation stops staging and removes its partial file", async () => {
  const controller = new AbortController();
  const operation = stageReadable(repeated(0x62, 1024 * 1024, 5), 1024 * 1024, {
    temporaryRoot: root,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(operation, /^Error: backup.cancelled$/);
  assert.deepEqual(await readdir(root), []);
});

test("the transfer deadline stops staging and removes its partial file", async () => {
  await assert.rejects(
    stageReadable(repeated(0x63, 1024 * 1024, 10), 1024 * 1024, {
      temporaryRoot: root,
      timeoutMs: 5,
    }),
    /^Error: backup.cancelled$/,
  );
  assert.deepEqual(await readdir(root), []);
});
