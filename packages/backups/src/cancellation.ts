const cancellationMessages = new Set(["backup.cancelled", "backup.verifier_cancelled"]);

export function isBackupCancellation(error: unknown, signal?: AbortSignal) {
  return Boolean(
    signal?.aborted &&
      (error === signal.reason ||
        (error instanceof Error &&
          (error.name === "AbortError" || cancellationMessages.has(error.message)))),
  );
}
