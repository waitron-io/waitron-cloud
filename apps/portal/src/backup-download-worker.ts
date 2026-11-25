import {scryptAsync} from '@noble/hashes/scrypt.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import forge from 'node-forge/lib/forge.js';
import 'node-forge/lib/aes.js';
import {accountRequest, type ApiResult} from './api.ts';
import {readBytes} from './backup-download-bytes.ts';
import {backupDownloadDirectory, isDatabaseStorageRefusal, removeDatabaseDownload, type DatabaseDownloadRequest} from './backup-types.ts';

interface SyncFile {
  read(bytes: Uint8Array, options: {at: number}): number;
  write(bytes: Uint8Array, options: {at: number}): number;
  close(): void;
}

async function openFile(directory: FileSystemDirectoryHandle, name: string) {
  const file = await directory.getFileHandle(name, {create: true}) as FileSystemFileHandle & {
    createSyncAccessHandle(): Promise<SyncFile>;
  };
  if (!file.createSyncAccessHandle) throw new DOMException('Storage is unavailable', 'NotSupportedError');
  return file.createSyncAccessHandle();
}

const archiveLimit = 16 * 1024 ** 2;
const expansionLimit = 4 * 1024 ** 3;
const databaseLimit = 512 * 1024 ** 2;
const databaseTooLarge = new Error('Database exceeds size limit');
const downloadInterrupted = new Error('Download interrupted');
const frameBytes = 49;
const text = new TextDecoder('utf-8', {fatal: true});
const binary = forge.util.binary.raw;
const refused = (code = 'database_open_failed'): ApiResult<never> => ({ok: false, status: 503, code, retryAfterMs: 0});

function writer(handle: SyncFile) {
  let offset = 0;
  return (chunk: Uint8Array) => {
    while (chunk.length) {
      const count = handle.write(chunk, {at: offset});
      if (!count) throw new DOMException('Storage made no progress', 'QuotaExceededError');
      offset += count;
      chunk = chunk.subarray(count);
    }
  };
}

async function authenticate(stream: ReadableStream<Uint8Array>, length: number, passphrase: string,
    expectedDigest: string, write: ReturnType<typeof writer>) {
  const input = readBytes(stream, length, downloadInterrupted);
  try {
    const header = await input.exact(frameBytes);
    if (text.decode(header.subarray(0, 4)) !== 'WBK1' || header[4] !== 1) throw new Error('Unsupported encryption');
    const digest = sha256.create().update(header);
    const key = await scryptAsync(passphrase, header.subarray(5, 21), {N: 2 ** 17, r: 8, p: 1, dkLen: 32});
    const cipher = forge.cipher.createDecipher('AES-GCM', binary.encode(key));
    key.fill(0);
    const start = () => cipher.start({iv: binary.encode(header.subarray(21, 33)), tag: forge.util.createBuffer(binary.encode(header.subarray(33))),
      additionalData: binary.encode(header.subarray(0, 33)), tagLength: 128});
    start();
    write(header);
    const complete = await input.take(length - frameBytes, chunk => {
      digest.update(chunk);
      write(chunk);
      for (let at = 0; at < chunk.length; at += 32 * 1024) {
        cipher.update(forge.util.createBuffer(binary.encode(chunk.subarray(at, at + 32 * 1024))));
        cipher.output.clear();
      }
    });
    if (!complete) throw downloadInterrupted;
    if (await input.take(1, () => {}) || bytesToHex(digest.digest()) !== expectedDigest || !cipher.finish()) {
      throw new Error('Invalid archive authentication');
    }
    start();
    return cipher;
  } finally { await input.close(); }
}

async function extractDatabase(handle: SyncFile, cipher: ReturnType<typeof forge.cipher.createDecipher>,
    write: ReturnType<typeof writer>) {
  let offset = frameBytes;
  function nextPlaintext() {
    const bytes = new Uint8Array(4096);
    const count = handle.read(bytes, {at: offset});
    offset += count;
    if (count) cipher.update(forge.util.createBuffer(binary.encode(bytes.subarray(0, count))));
    else if (!cipher.finish()) throw new Error('Staged archive failed authentication');
    return {done: count === 0, bytes: Uint8Array.from(binary.decode(cipher.output.getBytes()))};
  }
  const first = nextPlaintext();
  let yieldAt = performance.now() + 50;
  const raw = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {controller.enqueue(first.bytes);},
    async pull(controller) {
      if (performance.now() >= yieldAt) {
        // Leave the worker event loop a turn to process termination during local reads.
        await new Promise(resolve => setTimeout(resolve, 0));
        yieldAt = performance.now() + 50;
      }
      const next = nextPlaintext();
      if (next.bytes.length) controller.enqueue(next.bytes);
      if (next.done) controller.close();
    },
  });
  const stream = first.bytes[0] === 0x1f && first.bytes[1] === 0x8b ? raw.pipeThrough(new DecompressionStream('gzip')) : raw;
  const input = readBytes(stream, expansionLimit);
  try {
    const header = await input.exact(9);
    const count = new DataView(header.buffer).getUint32(5, true);
    if (text.decode(header.subarray(0, 4)) !== 'WBA1' || header[4] !== 1 || count > 4096) throw new Error('Unsupported backup');
    let found = false;
    for (let index = 0; index < count; index++) {
      const nameLength = new DataView((await input.exact(4)).buffer).getUint32(0, true);
      if (nameLength > 4096) throw new Error('Invalid entry name');
      const name = text.decode(await input.exact(nameLength));
      const length = Number(new DataView((await input.exact(8)).buffer).getBigUint64(0, true));
      if (name === 'db.dump') {
        if (length > databaseLimit) throw databaseTooLarge;
        if (found || length < 16) throw new Error('Invalid venue entry');
        const signature = await input.exact(16);
        if (text.decode(signature) !== 'SQLite format 3\0') throw new Error('Invalid SQLite signature');
        write(signature);
        if (!await input.take(length - 16, write)) throw new Error('Truncated database');
        found = true;
      } else if (!await input.take(length, () => {})) throw new Error('Truncated backup entry');
    }
    if (!found || await input.take(1, () => {})) throw new Error('Invalid backup entries');
  } finally { await input.close(); }
}

async function openDatabase({venueId, pointId, csrfToken, attempt}: DatabaseDownloadRequest): Promise<ApiResult<undefined>> {
  const body = {venueId, pointId};
  const manifest = await accountRequest<Blob>('/backups/download-manifest', body, undefined, csrfToken);
  if (!manifest.ok) return manifest;
  const {archiveManifestVersion, archiveSha256} = JSON.parse(await manifest.value.text());
  if (archiveManifestVersion !== 1 || typeof archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(archiveSha256)) return refused();
  const key = await accountRequest<Blob>('/backups/download-key', body, undefined, csrfToken);
  if (!key.ok) return key;
  const passphrase = await key.value.text();
  if (!/^[A-Za-z0-9_-]{43}\n$/.test(passphrase)) return refused();
  const archive = await accountRequest<Response>('/backups/download', body, undefined, csrfToken);
  if (!archive.ok) return archive;
  const response = archive.value, length = Number(response.headers.get('content-length'));
  if (!response.body || !Number.isSafeInteger(length) || length <= frameBytes || length > archiveLimit) {
    await response.body?.cancel();
    return refused(length > archiveLimit ? 'download_too_large' : undefined);
  }
  let root: FileSystemDirectoryHandle | undefined;
  try {
    root = await navigator.storage.getDirectory();
    const stage = await root.getDirectoryHandle(backupDownloadDirectory, {create: true});
    const directory = await stage.getDirectoryHandle(attempt, {create: true});
    const staging = await openFile(directory, 'archive.wbk');
    try {
      const cipher = await authenticate(response.body, length, passphrase.slice(0, -1), archiveSha256, writer(staging));
      const output = await openFile(directory, 'venue.db');
      try { await extractDatabase(staging, cipher, writer(output)); }
      finally { output.close(); }
    } finally { staging.close(); }
    await directory.removeEntry('archive.wbk');
    return {ok: true, value: undefined};
  } catch (error) {
    if (root) await removeDatabaseDownload(root);
    throw error;
  } finally { await response.body.cancel().catch(() => {}); }
}

self.addEventListener('message', (event: MessageEvent<DatabaseDownloadRequest>) => {
  void openDatabase(event.data).then(result => self.postMessage(result), error => {
    self.postMessage(refused(error === databaseTooLarge ? 'download_too_large'
      : error === downloadInterrupted ? 'network_error' : isDatabaseStorageRefusal(error) ? 'database_storage_unavailable' : undefined));
  });
}, {once: true});
