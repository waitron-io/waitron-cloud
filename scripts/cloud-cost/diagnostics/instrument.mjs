import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// This runs inside each generated page; observations never contain URL text or abort reasons.
export function installApplicationTrace() {
  let sequence = 0;
  const route = input => {
    try {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin !== new URL(location.href).origin) return 'outside';
      if (url.pathname === '/management-api/events') return 'live';
      if (url.pathname.startsWith('/management-api/alerts')) return 'alerts';
      if (url.pathname.startsWith('/management-api/reports/')) return 'report';
      return url.pathname.startsWith('/management-api/') ? 'api' : 'other';
    } catch { return 'other'; }
  };
  const record = (event, id = 0, kind = 'other', state = -1) =>
    console.debug('cost_application=' + JSON.stringify({event, id, route:kind, state, at:Date.now()}));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function(input, init) {
    const id = ++sequence, kind = route(input);
    record('fetch-start', id, kind);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.addEventListener('abort', () => record('fetch-abort', id, kind), {once:true});
    return Reflect.apply(originalFetch, this, [input, init]).then(
      response => { record('fetch-response', id, kind); return response; },
      error => { record('fetch-rejected', id, kind); throw error; });
  };
  const OriginalStream = globalThis.EventSource;
  globalThis.EventSource = class extends OriginalStream {
    constructor(...args) {
      super(...args);
      const id = ++sequence, kind = route(args[0]);
      this.traceIdentity = {id,kind};
      record('stream-create', id, kind, this.readyState);
      for (const event of ['open', 'error']) this.addEventListener(event,
        () => record('stream-' + event, id, kind, this.readyState));
    }
    close() {
      record('stream-close', this.traceIdentity.id, this.traceIdentity.kind, this.readyState);
      return super.close();
    }
  };
  addEventListener('beforeunload', () => record('beforeunload'));
  addEventListener('pagehide', () => record('pagehide'));
}

// Protocol events retain the document identity even when the page is unloading.
export function installRequestTrace(cdp, trace, origin) {
  const requests = new Map(), loaders = new Map();
  const identity = (map, value) => {
    if (!map.has(value)) { if (map.size >= 999) return 0; map.set(value, map.size + 1); }
    return map.get(value);
  };
  cdp.on('Network.requestWillBeSent', row => {
    try {
      const url = new URL(row.request.url), path = url.pathname;
      const route = url.origin !== origin ? 'outside' : path === '/management-api/events' ? 'live'
        : path.startsWith('/management-api/alerts') ? 'alerts'
        : path.startsWith('/management-api/reports/') ? 'report'
        : path.startsWith('/management-api/') ? 'api'
        : path === '/manage/' || path === '/manage' ? 'document' : 'other';
      const at = Math.round(row.wallTime * 1000); if (!Number.isSafeInteger(at) || at < 0) return;
      const frames = (row.initiator?.stack?.callFrames ?? []).slice(0, 3)
        .filter(frame => [frame.lineNumber, frame.columnNumber].every(n => Number.isSafeInteger(n) && n >= 0))
        .map(frame => ({line:frame.lineNumber, column:frame.columnNumber}));
      trace({event:'cdp-request', request:identity(requests, row.requestId), loader:identity(loaders, row.loaderId), route,
        resource:['Document','Fetch','XHR','EventSource','Script','Stylesheet','Image','Font','Other'].includes(row.type) ? row.type : 'Other',
        at, initiator:['parser','script','preload','preflight','other'].includes(row.initiator?.type) ? row.initiator.type : 'other', frames});
    } catch {}
  });
  cdp.on('Runtime.consoleAPICalled', event => {
    try {
      const text = event.args?.[0]?.value;
      if (typeof text !== 'string' || !text.startsWith('cost_application=') || text.length > 256) return;
      const row = JSON.parse(text.slice('cost_application='.length));
      if (!['fetch-start','fetch-response','fetch-abort','fetch-rejected','stream-create','stream-open','stream-error','stream-close','beforeunload','pagehide'].includes(row.event)
        || !['live','alerts','report','api','other','outside'].includes(row.route)
        || ![event.executionContextId,row.id,row.at,row.state].every(Number.isSafeInteger)
        || event.executionContextId < 0 || row.id < 0 || row.at < 0 || ![-1,0,1,2].includes(row.state)) return;
      trace({event:'cdp-application', context:event.executionContextId, action:row.event, request:row.id, route:row.route, state:row.state, at:row.at});
    } catch {}
  });
}

function replace(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Diagnostic insertion target changed');
  return source.replace(before, after);
}
const reporter = `import {appendFileSync as appendTrace} from 'node:fs';
const trace = value => { try { appendTrace('/tmp/cost-browser-trace.jsonl', JSON.stringify({ms: Math.round(performance.now()), ...value}) + '\\n'); } catch {} };
`;

const bufferedReporter = `import {appendFileSync as appendTrace} from 'node:fs';
const traceEvents = [];
const trace = value => { if (traceEvents.length < 10000) traceEvents.push({ms: Math.round(performance.now()), ...value}); };
process.once('exit', () => { try { appendTrace('/tmp/cost-browser-trace.jsonl', traceEvents.map(value => JSON.stringify(value)).join('\\n') + '\\n'); } catch {} });
`;
export function instrumentRemote(source, {buffered = false, compact = false} = {}) {
  source = (buffered ? bufferedReporter : reporter) + source;
  source = replace(source, 'const poison = reason => {', "const poison = reason => { trace({event:'poison',reason});");
  source = replace(source, "const upstream = connect({", "const connection = connections, browserPort = client.remotePort; trace({event:'admit',connection});\n    const upstream = connect({");
  source = replace(source, "upstream.once('connect', () => { connected = true; });", "upstream.once('connect', () => { connected = true; trace({event:'connected',connection}); });");
  source = replace(source, 'sockets.add(socket);', `sockets.add(socket);
      const state = () => ({connection, side, browserPort, gatewayPort:upstream.localPort, read:socket.bytesRead, written:socket.bytesWritten,
        readableEnded:socket.readableEnded, writableFinished:socket.writableFinished,
        readableLength:socket.readableLength, writableLength:socket.writableLength});
      ${compact ? '' : `socket.on('end', () => trace({event:'end',...state()}));
      socket.on('finish', () => trace({event:'finish',...state()}));
      socket.on('data', bytes => trace({event:'data',length:bytes.length,...state()}));`}`);
  source = replace(source, "poison('socket-' + side + '-' + kind);", "trace({event:'error',code:kind,...state()}); poison('socket-' + side + '-' + kind);");
  source = replace(source, "socket.once('close', () => {", "socket.once('close', () => { trace({event:'close',...state()});");
  return source;
}
export function instrumentBrowser(source, {buffered = false, compact = false, application = false} = {}) {
  source = (buffered ? bufferedReporter : reporter) + source;
  if (application) source = replace(source, 'const record = (req, event) => {', `
    const traceRequestIds = new WeakMap(); let traceNextRequest = 0;
    const traceRequest = req => {
      if (!traceRequestIds.has(req)) traceRequestIds.set(req, ++traceNextRequest);
      const url = new URL(req.url()), path = url.pathname;
      const category = url.origin !== 'https://' + staffHostname ? 'outside'
        : path === '/management-api/events' ? 'live'
        : path.startsWith('/management-api/alerts') ? 'alerts'
        : path.startsWith('/management-api/reports/') ? 'report'
        : path.startsWith('/management-api/') ? 'api' : 'other';
      const resource = req.resourceType();
      return {request:traceRequestIds.get(req), category,
        resource:['document','stylesheet','image','media','font','script','texttrack','xhr','fetch','eventsource','websocket','manifest','other'].includes(resource) ? resource : 'other'};
    };
    const tracePending = () => [...seen].map(req => ({key:keyFor(req), ...traceRequest(req)}));
    const record = (req, event) => {`);
  if (application) source = replace(source, "const pending = [], seen = new Set(), received = new WeakSet();", `
    context.on('console', message => {
      const text = message.text();
      if (!text.startsWith('cost_application=') || text.length > 256) return;
      try {
        const row = JSON.parse(text.slice('cost_application='.length));
        if (!['fetch-start','fetch-response','fetch-abort','fetch-rejected','stream-create','stream-open','stream-error','stream-close','beforeunload','pagehide'].includes(row.event)
          || !['live','alerts','report','api','other','outside'].includes(row.route)
          || ![row.id,row.at,row.state].every(Number.isSafeInteger) || row.id < 0 || row.at < 0 || ![-1,0,1,2].includes(row.state)) return;
        trace({event:'application', action:row.event, request:row.id, route:row.route, state:row.state, at:row.at});
      } catch {}
    });
    await context.addInitScript(${installApplicationTrace.toString()});
    const pending = [], seen = new Set(), received = new WeakSet();`);
  if (!compact || application) source = replace(source, "const key = keyFor(req) + ':' + event;", "const key = keyFor(req) + ':' + event; trace({event:'request',key,phase,at:Date.now()" + (application ? ',...traceRequest(req)' : '') + "});");
  if (application) {
    source = replace(source, "const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');",
      "const cdp = await context.newCDPSession(page); (" + installRequestTrace.toString() + ")(cdp, trace, 'https://' + staffHostname); await cdp.send('Network.enable'); await cdp.send('Runtime.enable');");
    source = replace(source, 'const deadline = Date.now() + 3000;', "trace({event:'drain-start',phase,at:Date.now(),pending:tracePending()}); const deadline = Date.now() + 3000;");
    source = replace(source, 'await Promise.all(pending);\n    };', "await Promise.all(pending); trace({event:'drain-return',phase,at:Date.now(),pending:tracePending()});\n    };");
  }
  source = replace(source, "args: ['--no-sandbox',", "args: ['--log-net-log=/tmp/cost-browser-netlog.json', '--no-sandbox',");
  source = replace(source, "phase = 'reconnect';", "phase = 'reconnect'; trace({event:'phase',phase,at:Date.now(),pending:" + (application ? 'tracePending()' : '[...seen].map(req=>keyFor(req))') + "});");
  source = replace(source, "const error = Error('Invalid cloud cost browser journey');", "trace({event:'refusal',phase,step,relay:meter?.failure()}); const error = Error('Invalid cloud cost browser journey');");
  return source;
}
export function instrumentFixture(source) {
  source = replace(source, 'const containers = []; let networkId;', 'const containers = []; let networkId, runner;');
  source = replace(source, "const runner = docker('create'", "runner = docker('create'");
  source = replace(source, "cpSync(new URL('./browser-diagnostics.mjs', import.meta.url), join(root, 'measure/browser-diagnostics.mjs'));",
    "cpSync(new URL('./browser-diagnostics.mjs', import.meta.url), join(root, 'measure/browser-diagnostics.mjs')); cpSync(new URL('../diagnostics/netlog-summary.mjs', import.meta.url), join(root, 'measure/netlog-summary.mjs'));");
  source = replace(source, 'const ownedContainers = new Set', `if (runner) {
      try { console.error('cost_browser_netlog=' + docker('exec', runner, 'node', '/measure/netlog-summary.mjs', '/tmp/cost-browser-netlog.json')); }
      catch { console.error('cost_browser_netlog=unavailable'); }
      try { console.error('cost_browser_socket_trace=' + docker('exec', runner, 'cat', '/tmp/cost-browser-trace.jsonl')); }
      catch { console.error('cost_browser_socket_trace=unavailable'); }
    }
    const ownedContainers = new Set`);
  return source;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, instrument] of [
    ['scripts/cloud-cost/remote.mjs', instrumentRemote],
    ['scripts/cloud-cost/browser.mjs', instrumentBrowser],
    ['scripts/cloud-cost/fixtures/remote-browser-conformance.test.mjs', instrumentFixture],
  ]) writeFileSync(path, instrument(readFileSync(path, 'utf8'), {buffered:true, compact:true, application:true}));
}
