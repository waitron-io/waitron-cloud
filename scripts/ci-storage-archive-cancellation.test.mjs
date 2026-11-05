import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { downloadStorageArchive } from "./fixtures/storage-archive-download.mjs";
import { downloadConformanceArchive } from "./cloud-cost/conformance-archive.mjs";

// Dropping the caller signal would publish bytes or retry after cancellation.
for (const stage of ["before request", "headers", "body", "retry pause"]) {
  test(`shared archive acquisition preserves caller cancellation at ${stage}`, { timeout: 5000 }, async t => {
    const controller = new AbortController();
    const reason = new Error("archive preparation interrupted");
    let requests = 0;
    const timers = new Set();
    const server = createServer((request, response) => {
      requests++;
      if (stage === "retry pause" && requests === 1) {
        response.writeHead(503); response.end(); return;
      }
      if (stage === "headers") controller.abort(reason);
      if (stage === "body") {
        response.writeHead(200); response.write("unverified partial archive");
      }
      const timer = setTimeout(() => response.end("archive bytes"), 100);
      timers.add(timer);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    });
    if (stage === "before request") controller.abort(reason);
    await assert.rejects(() => downloadStorageArchive(`http://127.0.0.1:${server.address().port}/archive`, {
      signal: controller.signal, timeoutMs: 120000, inactivityMs: 30000,
      report(record) {
        if (stage === "body" && record.event === "body" ||
            stage === "retry pause" && record.event === "retry") controller.abort(reason);
      },
    }), error => error === reason);
    assert.equal(requests, stage === "before request" ? 0 : 1, "cancellation cannot admit another request");
  });
}

for (const reason of [null, "interrupted"]) {
  test(`shared archive acquisition preserves a non-Error cancellation reason ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController(); controller.abort(reason);
    await assert.rejects(() => downloadStorageArchive("http://127.0.0.1:1/unused", {
      signal: controller.signal, timeoutMs: 120000, inactivityMs: 30000,
    }), error => Object.is(error, reason));
  });
}

// Native fixtures stop on a permanent status; conformance also retries a reset
// while discarding that status body. Neither policy may retry an ordinary error.
for (const retryStatusErrors of [false, true]) {
  for (const code of ["ECONNRESET", "UNCLASSIFIED"]) {
    test(`shared status-body ${code} preserves caller reset policy ${retryStatusErrors}`, async t => {
      const reason = Object.assign(new Error("controlled refused-body cancellation"), { code });
      let requests = 0;
      t.mock.method(globalThis, "fetch", async () => {
        requests++;
        const response = new Response("refused archive", { status: 404 });
        const cancel = response.body.cancel.bind(response.body);
        response.body.cancel = async () => { await cancel(); throw reason; };
        return response;
      });
      const controller = new AbortController();
      await assert.rejects(() => downloadStorageArchive("https://example.invalid/archive", {
        signal: controller.signal, retryStatusErrors,
      }), error => error === reason);
      assert.equal(requests, retryStatusErrors && code === "ECONNRESET" ? 3 : 1);
    });
  }
}

test("conformance retains reset retries while discarding a permanent refusal body", async t => {
  const reason = Object.assign(new Error("controlled refused-body reset"), { code: "ECONNRESET" });
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    const response = new Response("refused archive", { status: 404 });
    const cancel = response.body.cancel.bind(response.body);
    response.body.cancel = async () => { await cancel(); throw reason; };
    return response;
  });
  await assert.rejects(() => downloadConformanceArchive("https://example.invalid/archive", "0".repeat(64),
    "unused-refused-archive", { signal: new AbortController().signal, phase: "storage-archive" }),
  error => error === reason);
  assert.equal(requests, 3);
});

for (const callerSignal of [false, true]) {
  test(`retry deadline preserves the existing error contract with caller signal ${callerSignal}`, async t => {
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("temporary", { status: 503 }); });
    await assert.rejects(() => downloadStorageArchive("https://example.invalid/archive", {
      timeoutMs: 25, ...(callerSignal ? { signal: new AbortController().signal } : {}),
    }), error => callerSignal ? error.name === "TimeoutError" :
      error.name === "AbortError" && error.cause?.name === "TimeoutError");
    assert.equal(requests, 1, "the deadline interrupts the first retry pause");
  });
}
