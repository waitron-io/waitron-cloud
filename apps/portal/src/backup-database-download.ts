import {browserCsrfToken, type ApiResult} from './api.ts';
import {backupDownloadDirectory, isDatabaseStorageRefusal, removeDatabaseDownload, type DatabaseDownloadRequest} from './backup-types.ts';

const refused = (code = 'database_open_failed'): ApiResult<never> => ({ok: false, status: 503, code, retryAfterMs: 0});
let revokeSavedFile: (() => void) | undefined;

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

export async function clearAbandonedDatabaseDownload() {
  revokeSavedFile?.();
  try {
    await navigator.locks?.request(backupDownloadDirectory, {ifAvailable: true}, async lock => {
      if (lock) await removeWhenUnlocked(await navigator.storage.getDirectory());
    });
  } catch { /* Storage can be unavailable before any download is requested. */ }
}

async function openInWorker(request: DatabaseDownloadRequest, signal: AbortSignal) {
  const worker = new Worker('/backup-download-worker.js');
  let cancel: (() => void) | undefined;
  try {
    return await new Promise<ApiResult<undefined>>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = () => resolve(refused());
      cancel = () => { worker.terminate(); resolve(refused()); };
      signal.addEventListener('abort', cancel, {once: true});
      worker.postMessage(request);
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    worker.terminate();
  }
}

export async function downloadDatabase(venueId: string, pointId: string, signal: AbortSignal): Promise<ApiResult<undefined>> {
  if (!navigator.locks || !navigator.storage?.getDirectory) return refused('database_storage_unavailable');
  try {
    return await navigator.locks.request(backupDownloadDirectory, {signal}, async () => {
      revokeSavedFile?.();
      const root = await navigator.storage.getDirectory();
      await removeWhenUnlocked(root);
      const attempt = crypto.randomUUID();
      let saved = false;
      try {
        signal.throwIfAborted();
        const result = await openInWorker({venueId, pointId, attempt, csrfToken: browserCsrfToken()}, signal);
        if (!result.ok) return result;
        const staging = await root.getDirectoryHandle(backupDownloadDirectory);
        const directory = await staging.getDirectoryHandle(attempt);
        const file = await (await directory.getFileHandle('venue.db')).getFile();
        signal.throwIfAborted();
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `waitron-backup-${pointId}.venue.db`;
        link.click();
        const timer = setTimeout(() => {
          revokeSavedFile?.();
          void navigator.locks.request(backupDownloadDirectory, async () => {
            // An older tab's timer must leave a newer save alone.
            await staging.getDirectoryHandle(attempt);
            await removeWhenUnlocked(root);
          }).catch(() => {});
        }, 10 * 60_000);
        revokeSavedFile = () => { clearTimeout(timer); URL.revokeObjectURL(url); revokeSavedFile = undefined; };
        saved = true;
        return result;
      } finally { if (!saved) await removeWhenUnlocked(root); }
    });
  } catch (error) { return refused(isDatabaseStorageRefusal(error) ? 'database_storage_unavailable' : undefined); }
}
