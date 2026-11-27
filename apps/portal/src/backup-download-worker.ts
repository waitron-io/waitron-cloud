import {scryptAsync} from '@noble/hashes/scrypt.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import forge from 'node-forge/lib/forge.js';
import 'node-forge/lib/aes.js';
import {accountRequest, type ApiResult} from './api.ts';
import {readBytes} from './backup-download-bytes.ts';
import {backupDownloadDirectory, backupRangeBytes, databaseStorageRefusal, removeDatabaseDownload, type BackupExport, type BackupRangeStage, type DatabaseDownloadRequest} from './backup-types.ts';

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
const restoreKeyUnavailable = new Error('No usable numbered backup key');
const frameBytes = 49;
const restorePrefixBytes = 55;
const tagBytes = 16;
const text = new TextDecoder('utf-8', {fatal: true});
const encoder = new TextEncoder();
const binary = forge.util.binary.raw;
type Failure = Extract<ApiResult<never>,{ok:false}>;
const refused = (code = 'database_open_failed'): Failure => ({ok: false, status: 503, code, retryAfterMs: 0});

function writer(handle: SyncFile, offset = 0) {
  return (chunk: Uint8Array) => {
    while (chunk.length) {
      const count = handle.write(chunk, {at: offset});
      if (!count) throw new DOMException('Storage made no progress', 'QuotaExceededError');
      offset += count;
      chunk = chunk.subarray(count);
    }
  };
}

function memoryFile(size: number) {
  const bytes = new Uint8Array(size);
  return {
    bytes,
    read(buffer: Uint8Array, {at}: {at: number}) {
      const chunk = bytes.subarray(at, at + buffer.length);
      buffer.set(chunk);
      return chunk.length;
    },
    write(buffer: Uint8Array, {at}: {at: number}) { bytes.set(buffer, at); return buffer.length; },
    close() {},
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
    const start = () => {
      cipher.start({iv: binary.encode(header.subarray(21, 33)), tag: forge.util.createBuffer(binary.encode(header.subarray(33))),
        additionalData: binary.encode(header.subarray(0, 33)), tagLength: 128});
      return cipher;
    };
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
    return start;
  } finally { await input.close(); }
}

function stagedPlaintext(handle: SyncFile, cipher: ReturnType<typeof forge.cipher.createDecipher>) {
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
  return {raw, gzip: first.bytes[0] === 0x1f && first.bytes[1] === 0x8b};
}

async function visitArchive({raw, gzip}: ReturnType<typeof stagedPlaintext>,
    visit: (name: string, length: number, input: ReturnType<typeof readBytes>) => Promise<boolean>) {
  const stream = gzip ? raw.pipeThrough(new DecompressionStream('gzip')) : raw;
  const input = readBytes(stream, expansionLimit);
  try {
    const header = await input.exact(9);
    const count = new DataView(header.buffer).getUint32(5, true);
    if (text.decode(header.subarray(0, 4)) !== 'WBA1' || header[4] !== 1 || count > 4096) throw new Error('Unsupported backup');
    for (let index = 0; index < count; index++) {
      const nameLength = new DataView((await input.exact(4)).buffer).getUint32(0, true);
      if (nameLength > 4096) throw new Error('Invalid entry name');
      const name = text.decode(await input.exact(nameLength));
      const length = Number(new DataView((await input.exact(8)).buffer).getBigUint64(0, true));
      if (!await visit(name, length, input) && !await input.take(length, () => {})) throw new Error('Truncated backup entry');
    }
    if (await input.take(1, () => {})) throw new Error('Invalid backup entries');
  } finally { await input.close(); }
}

async function extractDatabase(plaintext: ReturnType<typeof stagedPlaintext>, write: ReturnType<typeof writer>) {
  let found = false;
  await visitArchive(plaintext, async (name, length, input) => {
    if (name !== 'db.dump') return false;
    if (length > databaseLimit) throw databaseTooLarge;
    if (found || length < 16) throw new Error('Invalid venue entry');
    const signature = await input.exact(16);
    if (text.decode(signature) !== 'SQLite format 3\0') throw new Error('Invalid SQLite signature');
    write(signature);
    if (!await input.take(length - 16, write)) throw new Error('Truncated database');
    found = true;
    return true;
  });
  if (!found) throw new Error('Missing venue entry');
}

async function readRestoreKey(plaintext: ReturnType<typeof stagedPlaintext>) {
  const fields = ['WAITRON_BACKUP_RECOVERY_KEY', 'WAITRON_BACKUP_KEY_NUMBER',
    'WAITRON_BACKUP_MASTER_KEY_ID', 'WAITRON_BACKUP_MASTER_KEY_DAY'];
  const values = new Map<string, string>();
  let found = false;
  await visitArchive(plaintext, async (name, length, input) => {
    if (name !== 'secrets/backup.env') return false;
    if (found || length > 16 * 1024) throw restoreKeyUnavailable;
    found = true;
    const bytes = await input.exact(length);
    try {
      for (const line of text.decode(bytes).split('\n')) {
        const equals = line.indexOf('=');
        const field = line.slice(0, equals);
        if (equals < 0 || !fields.includes(field)) continue;
        if (values.has(field)) throw restoreKeyUnavailable;
        values.set(field, line.slice(equals + 1));
      }
    } catch { throw restoreKeyUnavailable; }
    finally { bytes.fill(0); }
    return true;
  });
  const [encoded, number, masterKeyId, masterKeyDay] = fields.map(field => values.get(field) ?? '');
  const keyNumber = Number(number);
  const day = Date.parse(masterKeyDay!);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(encoded!) || !/^[1-9]\d{0,9}$/.test(number!) ||
      keyNumber > 0xffffffff || !/^[a-f0-9]{16}$/.test(masterKeyId!) || !/^\d{4}-\d{2}-\d{2}$/.test(masterKeyDay!) ||
      !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== masterKeyDay) throw restoreKeyUnavailable;
  return {backupKey: Uint8Array.from(atob(encoded!.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)),
    keyNumber, masterKeyId: masterKeyId!, masterKeyDay: masterKeyDay!};
}

async function sha256OfFile(file: SyncFile, length: number) {
  const input = readBytes(stagedStream(file), length);
  const digest = sha256.create();
  try {
    if (!await input.take(length, bytes => digest.update(bytes)) || await input.take(1, () => {})) throw downloadInterrupted;
    return bytesToHex(digest.digest());
  } finally { await input.close(); }
}

async function sealRestore(plaintext: ReadableStream<Uint8Array>, record: Awaited<ReturnType<typeof readRestoreKey>>,
    output: SyncFile, length: number) {
  // Waitron authenticates the entire version 2 prefix, including the numbered key identity.
  const header = new Uint8Array(restorePrefixBytes);
  header.set([87, 66, 75, 49, 2]);
  header.set(Uint8Array.from(record.masterKeyId.match(/../g)!, byte => Number.parseInt(byte, 16)), 5);
  new DataView(header.buffer).setUint32(13, record.keyNumber);
  header.set(encoder.encode(record.masterKeyDay), 17);
  crypto.getRandomValues(header.subarray(27));
  const key = hkdf(sha256, record.backupKey, header.subarray(27, 43), encoder.encode('waitron.archive.v2'), 32);
  let cipher;
  try { cipher = forge.cipher.createCipher('AES-GCM', binary.encode(key)); }
  finally { key.fill(0); }
  cipher.start({iv: binary.encode(header.subarray(43)), additionalData: binary.encode(header), tagLength: 128});
  writer(output)(header);
  const write = writer(output, header.length + tagBytes);
  const input = readBytes(plaintext, length);
  const flush = () => write(Uint8Array.from(binary.decode(cipher.output.getBytes())));
  try {
    if (!await input.take(length, chunk => {
      try { cipher.update(forge.util.createBuffer(binary.encode(chunk))); flush(); }
      finally { chunk.fill(0); }
    }) || await input.take(1, () => {}) || !cipher.finish()) throw downloadInterrupted;
    flush();
    writer(output, header.length)(Uint8Array.from(binary.decode(cipher.mode.tag.getBytes())));
    return await sha256OfFile(output, header.length + tagBytes + length);
  } finally { await input.close(); }
}

async function exportRestore(staging: SyncFile, open: Awaited<ReturnType<typeof authenticate>>, output: SyncFile,
    length: number, capturedAt: string): Promise<BackupExport['manifest']> {
  const record = await readRestoreKey(stagedPlaintext(staging, open()));
  try {
    const archiveSha256 = await sealRestore(stagedPlaintext(staging, open()).raw, record, output, length - frameBytes);
    return {archiveManifestVersion: 1, archiveVersion: 2, capturedAt, archiveSha256,
      masterKeyId: record.masterKeyId, masterKeyDay: record.masterKeyDay, laterChanges: 'unknown'};
  } finally { record.backupKey.fill(0); }
}

type RangeBatch = Omit<DatabaseDownloadRequest,'kind'> & {kind:'batch';stage:BackupRangeStage;offset:number;end:number};
type BatchResult = {offset:number;failure?:Failure};

async function downloadDirectory(attempt:string,create:boolean){
 const root=await navigator.storage.getDirectory();
 const parent=await root.getDirectoryHandle(backupDownloadDirectory,{create});
 return parent.getDirectoryHandle(attempt,{create});
}

async function readBatch({venueId,pointId,csrfToken,attempt,stage,end,offset}:RangeBatch):Promise<BatchResult>{
 const file=await openFile(await downloadDirectory(attempt,false),'archive.wbk');
 const write=writer(file,offset);
 try{
  for(;offset<end;offset+=backupRangeBytes){
   const reply=await accountRequest<Response>('/backups/download-range/read',{venueId,pointId,attemptId:stage.attemptId,offset:String(offset)},undefined,csrfToken);
   if(!reply.ok)return {offset,failure:reply};
   const {body,headers}=reply.value,length=Math.min(backupRangeBytes,stage.size-offset);
   if(!body||headers.get('content-range')!==`bytes ${offset}-${offset+length-1}/${stage.size}`||
      headers.get('content-length')!==String(length)||headers.has('content-encoding')){
    await body?.cancel().catch(()=>{});
    return {offset,failure:refused()};
   }
   const input=readBytes(body,length,downloadInterrupted);
   try{if(!await input.take(length,write)||await input.take(1,()=>{}))throw downloadInterrupted;}
   finally{await input.close();}
  }
  return {offset:Math.min(offset,stage.size)};
 }finally{file.close();}
}

async function stageRanges(request:DatabaseDownloadRequest,stage:BackupRangeStage):Promise<ApiResult<undefined>>{
 let offset=0, renewedAt:number|undefined;
 while(offset<stage.size){
  const end=Math.min(stage.size,offset+4*backupRangeBytes),worker=new Worker('/backup-download-worker.js');
  let reply:BatchResult;
  try{
   reply=await new Promise<BatchResult>((resolve,reject)=>{
    worker.onmessage=event=>resolve(event.data);
    worker.onerror=event=>reject(new Error(event.message));
    worker.postMessage({...request,kind:'batch',stage,offset,end} satisfies RangeBatch);
   });
  }finally{worker.terminate();}
  if(reply.failure){
   if(reply.failure.code!=='proof_required'||renewedAt===reply.offset)return reply.failure;
   renewedAt=reply.offset;
   const renewed=new Promise<boolean>(resolve=>self.addEventListener('message',event=>resolve(event.data?.kind==='proof'&&event.data.ok===true),{once:true}));
   self.postMessage({kind:'proof'});
   if(!await renewed)return reply.failure;
  }else if(reply.offset!==end)throw downloadInterrupted;
  offset=reply.offset;
 }
 return {ok:true,value:undefined};
}

function stagedStream(file:SyncFile){
 let offset=0;
 return new ReadableStream<Uint8Array>({pull(controller){
  const bytes=new Uint8Array(64*1024),count=file.read(bytes,{at:offset});
  if(count){offset+=count;controller.enqueue(bytes.subarray(0,count));}
  else controller.close();
 }});
}

async function openDatabase(request:DatabaseDownloadRequest):Promise<ApiResult<BackupExport | undefined>>{
  const {venueId,pointId,csrfToken,attempt,kind}=request;
  const body={venueId,pointId};
  let response:Response|undefined;
  let stage:BackupRangeStage|undefined;
  let root: FileSystemDirectoryHandle | undefined;
  async function release(){
   if(!stage)return;
   const attemptId=stage.attemptId;stage=undefined;
   const reply=await accountRequest('/backups/download-range/release',{...body,attemptId},AbortSignal.timeout(5000),csrfToken);
   if(reply.ok)self.postMessage({kind:'released'});
  }
  try {
    const manifest=await accountRequest<Blob>('/backups/download-manifest',body,undefined,csrfToken);
    if(!manifest.ok)return manifest;
    const {archiveManifestVersion,archiveSha256,capturedAt}=JSON.parse(await manifest.value.text());
    if(archiveManifestVersion!==1||typeof archiveSha256!=='string'||!/^[a-f0-9]{64}$/.test(archiveSha256))return refused();
    if (kind === 'archive' && (typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt)) ||
        new Date(capturedAt).toISOString() !== capturedAt)) return refused();
    const key=await accountRequest<Blob>('/backups/download-key',body,undefined,csrfToken);
    if(!key.ok)return key;
    const passphrase=await key.value.text();
    if(!/^[A-Za-z0-9_-]{43}\n$/.test(passphrase))return refused();
    const archive=await accountRequest<Response>('/backups/download',body,undefined,csrfToken);
    if(!archive.ok&&(archive.status!==413||request.memoryOnly))return archive;
    if(archive.ok)response=archive.value;
    if(!response){
      const start=await accountRequest<BackupRangeStage>('/backups/download-range/start',body,undefined,csrfToken);
      if(!start.ok)return start.status===404?refused('download_too_large'):start;
      stage=start.value;self.postMessage({kind:'stage',attemptId:stage.attemptId});
    }
    const length=stage?.size??Number(response?.headers.get('content-length'));
    if(!Number.isSafeInteger(length)||length<=frameBytes||!stage&&(!response?.body||length>archiveLimit)){
      return refused(length>archiveLimit?'download_too_large':undefined);
    }
    if (kind === 'archive' && response?.body) {
      const staging = memoryFile(length);
      const open = await authenticate(response.body,length,passphrase.slice(0,-1),archiveSha256,writer(staging));
      const output = memoryFile(length - frameBytes + restorePrefixBytes + tagBytes);
      const manifest = await exportRestore(staging, open, output, length, capturedAt);
      return {ok:true,value:{manifest,file:new Blob([output.bytes], {type:'application/octet-stream'})}};
    }
    root = await navigator.storage.getDirectory();
    const directory=await downloadDirectory(attempt,true);
    if(stage){
      const transferred=await stageRanges(request,stage);
      if(!transferred.ok){await removeDatabaseDownload(root);return transferred;}
      await release();
    }
    const staging = await openFile(directory, 'archive.wbk');
    let value: BackupExport | undefined;
    try {
      const open = await authenticate(response?.body??stagedStream(staging),length,passphrase.slice(0,-1),archiveSha256,
        response?writer(staging):()=>{});
      if(kind==='archive'){
        const output = await openFile(directory, 'backup.enc');
        try { value = {manifest:await exportRestore(staging, open, output, length, capturedAt)}; }
        finally { output.close(); }
      } else {
        const output = await openFile(directory, 'venue.db');
        try { await extractDatabase(stagedPlaintext(staging, open()), writer(output)); }
        finally { output.close(); }
      }
    } finally { staging.close(); }
    await directory.removeEntry('archive.wbk');
    return {ok: true, value};
  } catch (error) {
    if (root) await removeDatabaseDownload(root);
    throw error;
  } finally { await release();await response?.body?.cancel().catch(() => {}); }
}

self.addEventListener('message', (event: MessageEvent<DatabaseDownloadRequest|RangeBatch>) => {
  if(event.data.kind==='batch'){
    const offset=event.data.offset;
    void readBatch(event.data).then(result=>self.postMessage(result),error=>self.postMessage({offset,
      failure:refused(error===downloadInterrupted?'network_error':databaseStorageRefusal(error))}));
    return;
  }
  void openDatabase(event.data).then(result => self.postMessage(result), error => {
    self.postMessage(refused(error === databaseTooLarge ? 'download_too_large' : error === restoreKeyUnavailable ? 'restore_key_unavailable'
      : error === downloadInterrupted ? 'network_error' : databaseStorageRefusal(error)));
  });
}, {once: true});
