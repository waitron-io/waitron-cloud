import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const allowed = new Set(['URL_REQUEST_START_JOB', 'URL_REQUEST', 'CANCELLED',
  'HTTP_STREAM_REQUEST_BOUND_TO_JOB', 'HTTP_STREAM_JOB_BOUND_TO_REQUEST',
  'SOCKET_POOL_BOUND_TO_SOCKET', 'TCP_CONNECT', 'TCP_CONNECT_ATTEMPT',
  'SOCKET_ALIVE', 'SOCKET_CLOSED', 'SSL_CONNECT', 'SSL_HANDSHAKE_ERROR',
  'SSL_READ_ERROR', 'SSL_WRITE_ERROR']);
function route(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://staff.generated.example.test') return 'outside';
    if (url.pathname === '/management-api/events') return 'live';
    if (url.pathname === '/management-api/session/me') return 'session';
    if (url.pathname === '/management-api/reports/overview') return 'overview';
    if (url.pathname === '/management-api/reports/overdue-orders') return 'overdue';
    if (url.pathname.startsWith('/management-api/')) return 'api';
    if (url.pathname.startsWith('/manage/assets/')) return 'asset';
    if (['/manage','/manage/'].includes(url.pathname)) return 'document';
    return 'other';
  } catch { return 'other'; }
}
export function summarizeNetlog(log) {
  if (!log?.constants?.logEventTypes || !Array.isArray(log.events)) throw Error('Invalid browser trace');
  const types = new Map(Object.entries(log.constants.logEventTypes).filter(([name]) => allowed.has(name)).map(([name,id]) => [id,name]));
  const requests = new Map(), sockets = new Map(), events = [];
  for (const event of log.events) {
    const type = types.get(event.type), source = event.source?.id, params = event.params ?? {};
    if (!type || !Number.isSafeInteger(source) || source < 0) continue;
    if (type === 'URL_REQUEST_START_JOB' && typeof params.url === 'string') requests.set(source, route(params.url));
    if (type === 'TCP_CONNECT' && typeof params.local_address === 'string') {
      const match = /^127\.0\.0\.1:([0-9]{1,5})$/.exec(params.local_address);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) sockets.set(source, Number(match[1]));
    }
    const row = {type, source};
    for (const [name,value] of [['phase',event.phase],['time',Number(event.time)],
      ['dependency',params.source_dependency?.id],['error',params.net_error]])
      if (Number.isSafeInteger(value)) row[name] = value;
    events.push(row);
  }
  return {requests:[...requests].map(([source,route]) => ({source,route})),
    sockets:[...sockets].map(([source,port]) => ({source,port})), events};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(summarizeNetlog(JSON.parse(readFileSync(process.argv[2], 'utf8'))))); }
  catch { console.error('Browser trace unavailable'); process.exitCode = 1; }
}
