const {channel} = require('node:diagnostics_channel');
const {writeSync} = require('node:fs');
const {errorMonitor} = require('node:events');
const {threadId} = require('node:worker_threads');

// Observe the installer without changing its requests, retries, exit status or trust checks.
const requests = new WeakMap();
let sequence = 0;
const budgets = {ordinary: 32, failure: 8, child: 8, lifecycle: 2};
function report(record, category = 'ordinary') {
  if (budgets[category]-- <= 0) return;
  try {writeSync(2, `pnpm-setup-diagnostic ${JSON.stringify({time: Date.now(), pid: process.pid, thread: threadId, ...record})}\n`);}
  catch { /* Diagnostics must not turn a successful setup into a failure. */ }
}
function endpoint(path) {
  try {
    const name = decodeURIComponent(path.split('?')[0]);
    if (['/pnpm', '/@pnpm/exe', '/-/npm/v1/keys'].includes(name)) return name;
    if (/^\/@pnpm\/(?:linux|linuxstatic|macos|win|freebsd)-(?:x64|arm64|arm|ia32)(?:-musl)?$/.test(name)) return name;
  } catch { /* An unknown request remains outside the diagnostic's allowlist. */ }
}
function safeError(error, depth = 0) {
  const record = {name: ['Error', 'TypeError', 'SocketError', 'AbortError', 'ConnectTimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError', 'AggregateError'].includes(error?.name) ? error.name : 'other'};
  if (/^(?:UND_ERR_[A-Z_]{1,40}|E(?:CONNRESET|CONNREFUSED|PIPE|TIMEDOUT|AI_AGAIN|NOTFOUND|NOENT)|ABORT_ERR)$/.test(error?.code)) record.code = error.code;
  if (depth < 3 && error?.cause) record.cause = safeError(error.cause, depth + 1);
  return record;
}
function observe(name, listener) {
  channel(name).subscribe(message => {
    try {listener(message);}
    catch { /* An unexpected event shape must not fail the installer. */ }
  });
}
observe('undici:request:create', ({request}) => {
  const path = endpoint(request.path);
  if (!path) return;
  const record = {id: ++sequence, endpoint: path, registry: request.origin === 'https://registry.npmjs.org' ? 'npm' : 'other'};
  requests.set(request, record);
  report({event: 'http-start', ...record});
});
observe('undici:request:headers', ({request, response}) => {
  const record = requests.get(request);
  if (!record) return;
  record.status = response.statusCode;
  report({event: response.statusCode >= 400 ? 'http-status' : 'http-headers', ...record}, response.statusCode >= 400 ? 'failure' : 'ordinary');
});
observe('undici:request:trailers', ({request}) => {
  const record = requests.get(request);
  if (record) report({event: 'http-transfer-complete', ...record});
});
observe('undici:request:error', ({request, error}) => {
  const record = requests.get(request);
  if (record) report({event: 'http-error', ...record, error: safeError(error)}, 'failure');
});
observe('child_process', ({process: child}) => {
  // errorMonitor observes an error without handling it or suppressing Node's normal failure.
  child.once(errorMonitor, error => report({event: 'child-error', childPid: child.pid ?? null, error: safeError(error)}, 'child'));
  child.once('exit', (code, signal) => report({event: 'child-exit', childPid: child.pid, code, signal}, 'child'));
});
report({event: 'process-start', node: process.version}, 'lifecycle');
process.once('exit', code => report({event: 'process-exit', code}, 'lifecycle'));
