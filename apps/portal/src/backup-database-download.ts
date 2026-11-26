import {accountRequest,browserCsrfToken, type ApiResult} from './api.ts';
import {backupDownloadDirectory, databaseStorageRefusal, removeDatabaseDownload, type DatabaseDownloadRequest} from './backup-types.ts';

const refused = (code = 'database_open_failed'): ApiResult<never> => ({ok: false, status: 503, code, retryAfterMs: 0});
let revokeSavedFile: (() => void) | undefined;
const savedLockPrefix = `${backupDownloadDirectory}:`;

async function removeWhenUnlocked(root: FileSystemDirectoryHandle) {
  const deadline = AbortSignal.timeout(10_000);
  for (;;) {
    try { await removeDatabaseDownload(root); return; }
    catch (error) {
      if (!(error instanceof DOMException && error.name === 'NoModificationAllowedError') || deadline.aborted) throw error;
      // A document can lose its lock before its terminated worker releases the file.
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function hasLiveSave(root: FileSystemDirectoryHandle) {
  const {held} = await navigator.locks.query();
  const names = new Set(held?.map(lock => lock.name).filter(name => name?.startsWith(savedLockPrefix)));
  if (!names.size) return false;
  try {
    const staging = await root.getDirectoryHandle(backupDownloadDirectory);
    for await (const attempt of staging.keys()) if (names.has(savedLockPrefix + attempt)) return true;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
  return false;
}

function holdLiveSave(attempt: string) {
  return new Promise<() => void>((ready, reject) => {
    void navigator.locks.request(savedLockPrefix + attempt, () => new Promise<void>(release => {
      ready(release);
    })).catch(reject);
  });
}

export async function clearAbandonedDatabaseDownload() {
  revokeSavedFile?.();
  try {
    await navigator.locks?.request(backupDownloadDirectory, {ifAvailable: true}, async lock => {
      if (!lock) return;
      const root = await navigator.storage.getDirectory();
      if (!await hasLiveSave(root)) await removeWhenUnlocked(root);
    });
  } catch { /* Storage can be unavailable before any download is requested. */ }
}

async function openInWorker(request: DatabaseDownloadRequest, signal: AbortSignal, renewProof?:()=>Promise<boolean>) {
  const worker = new Worker('/backup-download-worker.js');
  let cancel: (() => void) | undefined;
  let attemptId: string | undefined;
  try {
    return await new Promise<ApiResult<undefined>>(resolve => {
      worker.onmessage = async ({data}) => {
        if(data.kind==='stage'){attemptId=data.attemptId;return;}
        if(data.kind==='released'){attemptId=undefined;return;}
        if(data.kind==='proof'){
          const ok=await (renewProof?.()??Promise.resolve(false)).catch(()=>false);
          if(!signal.aborted)worker.postMessage({kind:'proof',ok});
          return;
        }
        resolve(data);
      };
      worker.onerror = () => resolve(refused());
      cancel = () => { worker.terminate(); resolve(refused()); };
      signal.addEventListener('abort', cancel, {once: true});
      worker.postMessage(request);
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    worker.terminate();
    if(attemptId)await accountRequest('/backups/download-range/release',
      {venueId:request.venueId,pointId:request.pointId,attemptId},AbortSignal.timeout(5000),request.csrfToken);
  }
}

export async function downloadDatabase(venueId: string, pointId: string, signal: AbortSignal,
    {kind,renewProof}: {kind?:'archive';renewProof?:()=>Promise<boolean>} = {}): Promise<ApiResult<undefined>> {
  if (!navigator.locks || !navigator.storage?.getDirectory) return refused('database_storage_unavailable');
  try {
    return await navigator.locks.request(backupDownloadDirectory, {signal}, async () => {
      revokeSavedFile?.();
      const root = await navigator.storage.getDirectory();
      await removeWhenUnlocked(root);
      const attempt = crypto.randomUUID();
      let saved = false;
      let releaseLiveSave: (() => void) | undefined;
      try {
        signal.throwIfAborted();
        const result = await openInWorker({venueId, pointId, attempt, csrfToken: browserCsrfToken(),kind}, signal, renewProof);
        if (!result.ok) return result;
        const staging = await root.getDirectoryHandle(backupDownloadDirectory);
        const directory = await staging.getDirectoryHandle(attempt);
        const file = await (await directory.getFileHandle(kind==='archive'?'archive.wbk':'venue.db')).getFile();
        releaseLiveSave = await holdLiveSave(attempt);
        signal.throwIfAborted();
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `waitron-backup-${pointId}.${kind==='archive'?'backup.enc':'venue.db'}`;
        link.click();
        const timer = setTimeout(() => {
          revokeSavedFile?.();
          void navigator.locks.request(backupDownloadDirectory, async () => {
            // An older tab's timer must leave a newer save alone.
            await staging.getDirectoryHandle(attempt);
            await removeWhenUnlocked(root);
          }).catch(() => {});
        }, 10 * 60_000);
        revokeSavedFile = () => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          releaseLiveSave?.();
          revokeSavedFile = undefined;
        };
        saved = true;
        return result;
      } finally {
        if (!saved) { releaseLiveSave?.(); await removeWhenUnlocked(root); }
      }
    });
  } catch (error) { return refused(databaseStorageRefusal(error)); }
}
