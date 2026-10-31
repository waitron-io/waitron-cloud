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
function nativeEndpoint(path) {
  const metadata = endpoint(path);
  if (metadata) return metadata;
  try {
    const decoded = decodeURIComponent(path.split('?')[0]);
    const match = decoded.match(/^(.*)\/-\/([^/]+)-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/);
    if (match && endpoint(match[1]) && match[2] === match[1].split('/').at(-1)) return `${match[1]}/-/tarball`;
  } catch { /* A non-package URL remains outside the allowlist. */ }
}
function onceSafely(emitter, event, listener) {
  emitter.once(event, (...args) => {
    try {listener(...args);}
    catch { /* Observation must preserve the installer's event handling. */ }
  });
}
// A reset can reach both the request and response. Spend one failure record
// per request, and use the received status to identify the failing stage.
const nativeFailures = new WeakSet();
function nativeError(request, error) {
  const record = requests.get(request);
  if (!record || nativeFailures.has(request)) return;
  nativeFailures.add(request);
  report({event: 'http-error', ...record, stage: record.status === undefined ? 'request' : 'response',
    clientAborted: request.aborted === true, error: safeError(error)}, 'failure');
}
observe('http.client.request.created', ({request}) => {
  const path = nativeEndpoint(request.path);
  if (!path) return;
  const record = {id: ++sequence, client: 'node', endpoint: path,
    registry: request.protocol === 'https:' && request.host === 'registry.npmjs.org' && request.getHeader('host') === 'registry.npmjs.org' ? 'npm' : 'other'};
  requests.set(request, record);
  report({event: 'http-start', ...record});
  // npm's agent can fail before assigning a socket. Observe creation so its
  // connection failures remain visible without handling the error for npm.
  onceSafely(request, errorMonitor, error => nativeError(request, error));
  // An abort may have no error event before the installer exits. Completed wire
  // transfers can be aborted during caller cleanup and are not failed requests.
  onceSafely(request, 'abort', () => {
    if (request.res?.complete !== true) nativeError(request, {name: 'AbortError'});
  });
});
observe('http.client.response.finish', ({request, response}) => {
  const record = requests.get(request);
  if (!record) return;
  record.status = response.statusCode;
  report({event: response.statusCode >= 400 ? 'http-status' : 'http-headers', ...record}, response.statusCode >= 400 ? 'failure' : 'ordinary');
  // Never add a request response listener: Node uses its absence to drain an
  // ignored response. These listeners neither read nor resume the caller's body.
  onceSafely(response, errorMonitor, error => nativeError(request, error));
  onceSafely(response, 'end', () => report({event: 'http-transfer-complete', ...record}));
});
observe('child_process', ({process: child}) => {
  // errorMonitor observes an error without handling it or suppressing Node's normal failure.
  child.once(errorMonitor, error => report({event: 'child-error', childPid: child.pid ?? null, error: safeError(error)}, 'child'));
  child.once('exit', (code, signal) => report({event: 'child-exit', childPid: child.pid, code, signal}, 'child'));
});
report({event: 'process-start', node: process.version}, 'lifecycle');
process.once('exit', code => report({event: 'process-exit', code}, 'lifecycle'));
