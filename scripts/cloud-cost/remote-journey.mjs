import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { openRemoteMeasurement } from './remote.mjs';

const fail = () => { throw Error('Invalid cloud cost remote journey'); };
const need = value => { if (!value) fail(); };

// Each action opens a fresh TLS connection. This measures the named API scenario;
// browser assets, background updates and monthly session frequency need other evidence.
export async function measureRemoteJourneys(options) {
  const meters = [];
  try {
    const keys = ['staffHostname', 'publicHostname', 'staffCa', 'publicCa', 'email', 'password'];
    need(options && Object.getPrototypeOf(options) === Object.prototype
      && Reflect.ownKeys(options).length === keys.length
      && Reflect.ownKeys(options).every(k => keys.includes(k) && !Object.getOwnPropertyDescriptor(options, k).get));
    for (const key of ['staffHostname', 'publicHostname'])
      need(typeof options[key] === 'string' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(options[key]) && options[key].length <= 253);
    need(options.staffHostname !== options.publicHostname);
    for (const key of ['email', 'password']) need(typeof options[key] === 'string' && options[key].length > 0 && options[key].length <= 1024);
    for (const key of ['staffCa', 'publicCa']) need(Buffer.isBuffer(options[key]) && options[key].length > 0 && options[key].length <= 65536);
    const evidence = [];
    for (const audience of ['staff', 'public']) {
      const meter = await openRemoteMeasurement({ target: 'tcp://127.0.0.1:443', audience }); meters.push(meter);
      const host = options[audience + 'Hostname'], ca = options[audience + 'Ca'];
      let requests = 0, requestBodyBytes = 0, responseBodyBytes = 0;
      const actions = [];
      const call = async (action, path, status, { body, cookie, method = body === undefined ? 'GET' : 'POST' } = {}) => {
        const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const reply = await new Promise((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port: meter.port, servername: host, ca, agent: false, path, method,
            headers: { host, origin: 'https://' + host, ...(cookie ? { cookie } : {}),
              ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, res => {
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 1048576) req.destroy(); else chunks.push(chunk); });
            res.on('error', reject); res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
          });
          req.setTimeout(3000, () => req.destroy()); req.on('error', reject); req.end(bytes);
        });
        need(reply.status === status);
        requests++; requestBodyBytes += bytes?.length ?? 0; responseBodyBytes += reply.bytes.length;
        actions.push({ action, status, requestBodyBytes: bytes?.length ?? 0, responseBodyBytes: reply.bytes.length });
        return reply;
      };
      if (audience === 'staff') {
        await call('anonymous-read-refused', '/management-api/staff', 401);
        await call('invalid-sign-in-refused', '/management-api/session', 401,
          { body: { email: options.email, password: 'invalid-' + options.password } });
        const login = await call('sign-in', '/management-api/session', 200, { body: { email: options.email, password: options.password } });
        need(typeof JSON.parse(login.bytes).personId === 'string');
        const cookies = login.headers['set-cookie']; need(Array.isArray(cookies) && cookies.length > 0);
        const cookie = cookies.map(value => value.split(';')[0]).join('; ');
        need(cookie.length > 0);
        const staff = await call('staff-read', '/management-api/staff', 200, { cookie });
        need(Array.isArray(JSON.parse(staff.bytes)) && JSON.parse(staff.bytes).length > 0);
        const canvases = await call('dashboard-canvases-read', '/management-api/canvases', 200, { cookie });
        need(Array.isArray(JSON.parse(canvases.bytes).canvases));
        const theme = await call('dashboard-theme-read', '/management-api/theme', 200, { cookie });
        need(Object.hasOwn(JSON.parse(theme.bytes), 'theme'));
        const again = await call('staff-reconnect-read', '/management-api/staff', 200, { cookie });
        need(again.bytes.equals(staff.bytes));
        await call('sign-out', '/management-api/session', 204, { cookie, method: 'DELETE' });
        await call('signed-out-read-refused', '/management-api/staff', 401, { cookie });
      } else {
        await call('unchallenged-public-refused', '/public/availability', 403);
        const challengeReply = await call('challenge', '/_cloud/challenge', 200);
        const challenge = JSON.parse(challengeReply.bytes);
        need(typeof challenge.challenge === 'string' && Number.isInteger(challenge.difficulty) && challenge.difficulty >= 1 && challenge.difficulty <= 24);
        let nonce = 0;
        while (createHash('sha256').update(challenge.challenge + ':' + nonce).digest().readUInt32BE(0) >= 2 ** (32 - challenge.difficulty)) {
          if (++nonce >= 16777216) fail();
        }
        await call('proof-worker-read', '/_cloud/worker.js', 200);
        const solved = await call('proof-submit', '/_cloud/solve', 204, { body: { challenge: challenge.challenge, nonce } });
        need(Array.isArray(solved.headers['set-cookie']) && solved.headers['set-cookie'].length > 0);
        const cookie = solved.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
        const available = await call('public-availability-read', '/public/availability', 200, { cookie });
        need(JSON.parse(available.bytes).available === true);
        await call('public-management-refused', '/management-api/staff', 404, { cookie });
      }
      await meter.close(); const snapshot = meter.snapshot();
      need(snapshot.producer.connections === requests && snapshot.producer.bytesToGateway > requestBodyBytes
        && snapshot.producer.bytesFromGateway > responseBodyBytes);
      evidence.push({ audience, scenario: audience === 'staff' ? 'owner-management-api' : 'public-availability-api',
        requests, requestBodyBytes, responseBodyBytes, actions, snapshot });
    }
    return { kind: 'pinned-waitron-api-gateway', costMeasured: false, evidence };
  } catch { fail(); }
  finally { for (const meter of meters) await meter.close().catch(() => {}); }
}
