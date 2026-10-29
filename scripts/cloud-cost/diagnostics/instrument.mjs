import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

function replace(source, before, after) {
  if (source.split(before).length !== 2) throw Error('Diagnostic insertion target changed');
  return source.replace(before, after);
}
const reporter = `import {appendFileSync as appendTrace} from 'node:fs';
const traceStart = performance.now();
const trace = value => { try { appendTrace('/tmp/cost-browser-trace.jsonl', JSON.stringify({ms: Math.round(performance.now() - traceStart), ...value}) + '\\n'); } catch {} };
`;

export function instrumentRemote(source) {
  source = reporter + source;
  source = replace(source, 'const poison = reason => {', "const poison = reason => { trace({event:'poison',reason});");
  source = replace(source, "const upstream = connect({", "const connection = connections; trace({event:'admit',connection});\n    const upstream = connect({");
  source = replace(source, "upstream.once('connect', () => { connected = true; });", "upstream.once('connect', () => { connected = true; trace({event:'connected',connection}); });");
  source = replace(source, 'sockets.add(socket);', `sockets.add(socket);
      const state = () => ({connection, side, read:socket.bytesRead, written:socket.bytesWritten,
        readableEnded:socket.readableEnded, writableFinished:socket.writableFinished,
        readableLength:socket.readableLength, writableLength:socket.writableLength});
      socket.on('end', () => trace({event:'end',...state()}));
      socket.on('finish', () => trace({event:'finish',...state()}));
      socket.on('data', bytes => trace({event:'data',length:bytes.length,...state()}));`);
  source = replace(source, "poison('socket-' + side + '-' + kind);", "trace({event:'error',code:kind,...state()}); poison('socket-' + side + '-' + kind);");
  source = replace(source, "socket.once('close', () => {", "socket.once('close', () => { trace({event:'close',...state()});");
  return source;
}
export function instrumentBrowser(source) {
  source = reporter + source;
  source = replace(source, "const key = keyFor(req) + ':' + event;", "const key = keyFor(req) + ':' + event; trace({event:'request',key,phase});");
  source = replace(source, "phase = 'reconnect';", "phase = 'reconnect'; trace({event:'phase',phase});");
  source = replace(source, "const error = Error('Invalid cloud cost browser journey');", "trace({event:'refusal',phase,step,relay:meter?.failure()}); const error = Error('Invalid cloud cost browser journey');");
  return source;
}
export function instrumentFixture(source) {
  source = replace(source, 'const containers = []; let networkId;', 'const containers = []; let networkId, runner;');
  source = replace(source, "const runner = docker('create'", "runner = docker('create'");
  source = replace(source, 'const ownedContainers = new Set', `if (runner) {
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
  ]) writeFileSync(path, instrument(readFileSync(path, 'utf8')));
}
