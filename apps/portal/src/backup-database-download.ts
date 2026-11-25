import {browserCsrfToken, type ApiResult} from './api.ts';
import {backupDownloadDirectory, removeDatabaseDownload} from './backup-types.ts';

const failed: ApiResult<never> = {ok: false, status: 503, code: 'database_open_failed', retryAfterMs: 0};

export async function clearAbandonedDatabaseDownload() {
  try {
    await navigator.locks?.request(backupDownloadDirectory, {ifAvailable: true}, async lock => {
      if (lock) await removeDatabaseDownload(await navigator.storage.getDirectory());
    });
  } catch { /* Storage can be unavailable before any download is requested. */ }
}

async function openInWorker(venueId: string, pointId: string, signal: AbortSignal) {
  const worker = new Worker('/backup-download-worker.js');
  const cancel = () => worker.postMessage('cancel');
  try {
    return await new Promise<ApiResult<undefined>>(resolve => {
      worker.onmessage = event => resolve(event.data);
      worker.onerror = () => resolve(failed);
      signal.addEventListener('abort', cancel, {once: true});
      worker.postMessage({venueId, pointId, csrfToken: browserCsrfToken()});
    });
  } finally {
    signal.removeEventListener('abort', cancel);
    worker.terminate();
  }
}

export async function downloadDatabase(venueId: string, pointId: string, signal: AbortSignal): Promise<ApiResult<undefined>> {
  try {
    return await navigator.locks.request(backupDownloadDirectory, {ifAvailable: true}, async lock => {
      if (!lock) return failed;
      const root = await navigator.storage.getDirectory();
      await removeDatabaseDownload(root);
      let url: string | undefined;
      try {
        signal.throwIfAborted();
        const result = await openInWorker(venueId, pointId, signal);
        if (!result.ok) return result;
        const directory = await root.getDirectoryHandle(backupDownloadDirectory);
        const file = await (await directory.getFileHandle('venue.db')).getFile();
        signal.throwIfAborted();
        url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = `waitron-backup-${pointId}.venue.db`;
        link.click();
        // Let the browser open the file before revoking its URL and unlinking it.
        const release = AbortSignal.any([signal, AbortSignal.timeout(1000)]);
        if (!release.aborted) await new Promise<void>(resolve => release.addEventListener('abort', () => resolve(), {once: true}));
        return result;
      } finally {
        if (url) URL.revokeObjectURL(url);
        await removeDatabaseDownload(root);
      }
    });
  } catch { return failed; }
}
