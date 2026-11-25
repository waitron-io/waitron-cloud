import {scryptAsync} from '@noble/hashes/scrypt.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import forge from 'node-forge/lib/forge.js';
import 'node-forge/lib/aes.js';
import {accountRequest, type ApiResult} from './api.ts';
import {backupDownloadDirectory, removeDatabaseDownload, type DatabaseDownloadRequest} from './backup-types.ts';

interface SyncFile {
  read(bytes: Uint8Array, options: {at: number}): number;
  write(bytes: Uint8Array, options: {at: number}): number;
  close(): void;
}

async function openFile(directory: FileSystemDirectoryHandle, name: string) {
  const file = await directory.getFileHandle(name, {create: true}) as FileSystemFileHandle & {
    createSyncAccessHandle(): Promise<SyncFile>;
  };
  return file.createSyncAccessHandle();
}

const archiveLimit = 16 * 1024 ** 2;
const expansionLimit = 4 * 1024 ** 3;
const frameBytes = 49;
const text = new TextDecoder('utf-8', {fatal: true});
const binary = forge.util.binary.raw;
const refused = (code = 'database_open_failed'): ApiResult<never> => ({ok: false, status: 503, code, retryAfterMs: 0});

function readBytes(stream: ReadableStream<Uint8Array>, max: number, signal: AbortSignal) {
  const reader = stream.getReader();
  let remaining = new Uint8Array(0) as Uint8Array<ArrayBufferLike>;
  let received = 0;
  async function take(length: number, consume: (chunk: Uint8Array) => void) {
    while (length > 0) {
      signal.throwIfAborted();
      if (!remaining.length) {
        const next = await reader.read();
        if (next.done) return false;
        remaining = next.value;
        received += remaining.length;
        if (received > max) throw new Error('Size limit exceeded');
      }
      const size = Math.min(length, remaining.length);
      consume(remaining.subarray(0, size));
      remaining = remaining.subarray(size);
      length -= size;
    }
    return true;
  }
  return {
    take,
    async exact(length: number) {
      const bytes = new Uint8Array(length);
      let offset = 0;
      if (!await take(length, chunk => { bytes.set(chunk, offset); offset += chunk.length; })) throw new Error('Truncated backup');
      return bytes;
    },
    async close() { await reader.cancel().catch(() => {}); },
  };
}

function writer(handle: SyncFile) {
  let offset = 0;
  return (chunk: Uint8Array) => {
    while (chunk.length) {
      const count = handle.write(chunk, {at: offset});
      if (!count) throw new Error('Storage made no progress');
      offset += count;
      chunk = chunk.subarray(count);
    }
  };
}

async function authenticate(stream: ReadableStream<Uint8Array>, length: number, passphrase: string,
    expectedDigest: string, write: ReturnType<typeof writer>, signal: AbortSignal) {
  const input = readBytes(stream, length, signal);
  try {
    const header = await input.exact(frameBytes);
    if (text.decode(header.subarray(0, 4)) !== 'WBK1' || header[4] !== 1) throw new Error('Unsupported encryption');
    const digest = sha256.create().update(header);
    const key = await scryptAsync(passphrase, header.subarray(5, 21), {N: 2 ** 17, r: 8, p: 1, dkLen: 32});
    const cipher = forge.cipher.createDecipher('AES-GCM', binary.encode(key));
    key.fill(0);
    cipher.start({iv: binary.encode(header.subarray(21, 33)), tag: forge.util.createBuffer(binary.encode(header.subarray(33))),
      additionalData: binary.encode(header.subarray(0, 33)), tagLength: 128});
    const complete = await input.take(length - frameBytes, chunk => {
      digest.update(chunk);
      for (let at = 0; at < chunk.length; at += 32 * 1024) {
        cipher.update(forge.util.createBuffer(binary.encode(chunk.subarray(at, at + 32 * 1024))));
        write(binary.decode(cipher.output.getBytes()));
      }
    });
    if (!complete) throw new Error('Truncated download');
    if (await input.take(1, () => {}) || bytesToHex(digest.digest()) !== expectedDigest || !cipher.finish()) {
      throw new Error('Invalid archive authentication');
    }
    write(binary.decode(cipher.output.getBytes()));
  } finally { await input.close(); }
}

async function extractDatabase(handle: SyncFile, write: ReturnType<typeof writer>, signal: AbortSignal) {
  const prefix = new Uint8Array(2);
  handle.read(prefix, {at: 0});
  let offset = 0;
  const raw = new ReadableStream<Uint8Array<ArrayBuffer>>({pull(controller) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(4096);
    const count = handle.read(bytes, {at: offset});
    if (!count) { controller.close(); return; }
    offset += count;
    controller.enqueue(bytes.subarray(0, count));
  }});
  const stream = prefix[0] === 0x1f && prefix[1] === 0x8b ? raw.pipeThrough(new DecompressionStream('gzip')) : raw;
  const input = readBytes(stream, expansionLimit, signal);
  try {
    const header = await input.exact(9);
    const count = new DataView(header.buffer).getUint32(5, true);
    if (text.decode(header.subarray(0, 4)) !== 'WBA1' || header[4] !== 1 || count > 4096) throw new Error('Unsupported backup');
    let found = false;
    for (let index = 0; index < count; index++) {
      const nameLength = new DataView((await input.exact(4)).buffer).getUint32(0, true);
      if (nameLength > 4096) throw new Error('Invalid entry name');
      const name = text.decode(await input.exact(nameLength));
      const length = new DataView((await input.exact(8)).buffer).getBigUint64(0, true);
      if (length > BigInt(expansionLimit)) throw new Error('Entry exceeds size limit');
      if (name === 'db.dump') {
        if (found || length < 16n) throw new Error('Invalid venue entry');
        const signature = await input.exact(16);
        if (text.decode(signature) !== 'SQLite format 3\0') throw new Error('Invalid SQLite signature');
        write(signature);
        if (!await input.take(Number(length) - 16, write)) throw new Error('Truncated database');
        found = true;
      } else if (!await input.take(Number(length), () => {})) throw new Error('Truncated backup entry');
    }
    if (!found || await input.take(1, () => {})) throw new Error('Invalid backup entries');
  } finally { await input.close(); }
}

async function openDatabase({venueId, pointId, csrfToken}: DatabaseDownloadRequest, signal: AbortSignal): Promise<ApiResult<undefined>> {
  const body = {venueId, pointId};
  const manifest = await accountRequest<Blob>('/backups/download-manifest', body, signal, csrfToken);
  if (!manifest.ok) return manifest;
  const {archiveManifestVersion, archiveSha256} = JSON.parse(await manifest.value.text());
  if (archiveManifestVersion !== 1 || typeof archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archiveSha256)) return refused();
  const key = await accountRequest<Blob>('/backups/download-key', body, signal, csrfToken);
  if (!key.ok) return key;
  const passphrase = await key.value.text();
  if (!/^[A-Za-z0-9_-]{43}\n$/.test(passphrase)) return refused();
  const archive = await accountRequest<Response>('/backups/download', body, signal, csrfToken);
  if (!archive.ok) return archive;
  const response = archive.value, length = Number(response.headers.get('content-length'));
  if (!response.body || !Number.isSafeInteger(length) || length <= frameBytes || length > archiveLimit) {
    await response.body?.cancel();
    return refused(length > archiveLimit ? 'download_too_large' : undefined);
  }
  let root: FileSystemDirectoryHandle | undefined;
  try {
    root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle(backupDownloadDirectory, {create: true});
    const staging = await openFile(directory, 'archive.wba');
    try {
      await authenticate(response.body, length, passphrase.slice(0, -1), archiveSha256, writer(staging), signal);
      const output = await openFile(directory, 'venue.db');
      try { await extractDatabase(staging, writer(output), signal); }
      finally { output.close(); }
    } finally { staging.close(); }
    await directory.removeEntry('archive.wba');
    signal.throwIfAborted();
    return {ok: true, value: undefined};
  } catch (error) {
    if (root) await removeDatabaseDownload(root);
    throw error;
  } finally { await response.body.cancel().catch(() => {}); }
}

const abort = new AbortController();
let started = false;
self.addEventListener('message', (event: MessageEvent<DatabaseDownloadRequest | 'cancel'>) => {
  if (event.data === 'cancel') { abort.abort(); return; }
  if (started) return;
  started = true;
  void openDatabase(event.data, abort.signal).then(result => self.postMessage(result), () => self.postMessage(refused()));
});
