import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

async function checkStatus(response) {
  if (!response.ok) await response.body?.cancel();
  assert.equal(response.ok, true, "the pinned release archive must be available");
}

async function readChunks(response, progress) {
  const chunks = [];
  for await (const chunk of response.body) {
    chunks.push(chunk);
    progress(chunk.length);
  }
  return Buffer.concat(chunks);
}

// Callers retain their digest/publication rules and choose their attempt policy.
export async function downloadStorageArchive(url, {
  attempts = 3, timeoutMs = 30000, inactivityMs = 10000,
  signal, inactivityReason = new DOMException("Storage seed transfer stalled", "TimeoutError"),
  retryStatusErrors = false,
  report = () => {}, validate = checkStatus, consume = readChunks,
} = {}) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const budget = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let phase, status, bytesReceived, attempt;
  const emit = (event, details = {}) => {
    // A diagnostic sink cannot change acquisition or hide its original error.
    try { report({ event, phase, status, bytesReceived, attempt, ...details }); } catch {}
  };
  for (attempt = 1; ; attempt++) {
    budget.throwIfAborted();
    phase = "headers"; status = null; bytesReceived = 0; emit("attempt");
    const inactivity = new AbortController();
    let idleTimer, retryable = false;
    const progress = (length = 0) => {
      bytesReceived += length;
      clearTimeout(idleTimer);
      if (inactivityMs !== null) idleTimer = setTimeout(() => inactivity.abort(inactivityReason), inactivityMs);
    };
    try {
      progress();
      const response = await fetch(url, { signal: AbortSignal.any([budget, inactivity.signal]) });
      progress();
      phase = "status"; status = response.status; emit("headers");
      retryable = !response.ok && status >= 500 && status <= 599;
      await validate(response);
      phase = "body"; emit("body");
      const bytes = await consume(response, progress);
      budget.throwIfAborted();
      return bytes;
    } catch (error) {
      clearTimeout(idleTimer);
      budget.throwIfAborted();
      const reset = ["ECONNRESET", "UND_ERR_SOCKET"].includes(error?.cause?.code ?? error?.code);
      if (attempt >= attempts || (!retryStatusErrors && phase === "status" && !retryable) ||
          (!retryable && !reset && !inactivity.signal.aborted)) throw error;
      emit("retry", { error });
      // Pauses spend the original budget; a new attempt never resets it.
      try { await delay(attempt * 1000, undefined, { signal: budget }); }
      catch (error) { if (signal) budget.throwIfAborted(); throw error; }
    } finally {
      clearTimeout(idleTimer);
      emit("settled");
    }
  }
}

if (import.meta.main) {
  try {
    assert.equal(process.argv.length, 4, "Usage: storage-archive-download.mjs <url> <output>");
    const bytes = await downloadStorageArchive(process.argv[2], {
      report({ event, phase, status, bytesReceived, attempt }) {
        console.error(JSON.stringify({ event, phase, status, bytesReceived, attempt }));
      },
    });
    await writeFile(process.argv[3], bytes);
  } catch (error) {
    console.error(JSON.stringify({ event: "failed", name: error.name, code: error.cause?.code ?? error.code }));
    process.exitCode = 1;
  }
}
