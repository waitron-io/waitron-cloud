// Synthetic service journey only; never loaded by the private replay controller.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const fail = () => { throw Error('Synthetic stack check failed'); };
const config = () => JSON.parse(readFileSync('/state/replay-config.json', 'utf8'));
const request = (url, { method = 'GET', body, tls = false } = {}) => new Promise((resolve, reject) => {
  const bytes = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const req = (tls ? https : http).request(url, { method, headers: bytes ? { 'content-length': bytes.length } : {},
    ...(tls ? { ca: readFileSync('/state/gateway-cert.pem') } : {}) }, res => {
    const parts = []; let length = 0;
    res.on('data', chunk => { length += chunk.length; if (length > 1048576) req.destroy(Error('response too large')); else parts.push(chunk); });
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() }));
    res.on('error', reject);
  });
  req.setTimeout(2000, () => req.destroy(Error('timeout'))); req.on('error', reject); req.end(bytes);
});
async function capturedMail() {
  // SMTP replies can contain several lines; consume each complete reply before the next command.
  const socket = net.connect(1025, 'mailpit'); socket.setTimeout(2000, () => socket.destroy(Error('timeout')));
  let buffered = '', waiting, failure;
  socket.on('error', e => { failure = e; waiting?.reject(e); });
  const dispatch = () => {
    const match = buffered.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/);
    if (match && waiting) { const pending = waiting; waiting = null; buffered = buffered.slice(match.index + match[0].length); pending.resolve(Number(match[1])); }
  };
  socket.on('data', b => { buffered += b.toString(); dispatch(); });
  const reply = () => new Promise((resolve, reject) => { if (failure) return reject(failure); waiting = { resolve, reject }; dispatch(); });
  try {
    if (await reply() !== 220) fail();
    for (const [command, code] of [['EHLO fixture\r\n', 250], ['MAIL FROM:<fixture@example.test>\r\n', 250],
      ['RCPT TO:<capture@example.test>\r\n', 250], ['DATA\r\n', 354],
      ['From: fixture@example.test\r\nTo: capture@example.test\r\nSubject: Synthetic\r\n\r\nSynthetic\r\n.\r\n', 250], ['QUIT\r\n', 221]]) {
      socket.write(command); if (await reply() !== code) fail();
    }
  } finally { socket.destroy(); }
}
async function smoke() {
  const pg = spawnSync('psql', [config().config.localEndpoints.postgres, '-Atc', 'SELECT 42'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (pg.status !== 0) fail();
  const bucket = 'http://s3:8333/synthetic-stack';
  if ((await request(bucket, { method: 'PUT' })).status !== 200) fail();
  if ((await request(bucket + '/probe', { method: 'PUT', body: 'Synthetic bytes' })).status !== 200) fail();
  const object = await request(bucket + '/probe');
  const storageRoundTrip = object.status === 200 && object.body === 'Synthetic bytes';
  if ((await request(bucket + '/probe', { method: 'DELETE' })).status !== 204) fail();
  if ((await request(bucket, { method: 'DELETE' })).status !== 204) fail();
  await capturedMail();
  const inbox = JSON.parse((await request('http://mailpit:8025/api/v1/messages')).body);
  const fiscal = await request('http://fiscal:8080/submit', { method: 'POST', body: { synthetic: true } });
  if (fiscal.status !== 200) fail();
  const instant = '2026-01-01T12:00:00.000Z';
  const sale = { origin: { source: 'operator_script', deviceId: null }, locale: 'es', invoiceLocales: ['es'], total: '12.10',
    lines: [{ lineNo: 1, name: 'Synthetic item', descriptions: { es: 'Synthetic item' }, quantity: '1', unitPrice: '10.00', vatRate: '21.00', lineTotal: '10.00' }],
    instant, settlement: { kind: 'immediate', tenders: [{ method: 'cash', amount: '12.10', tipAmount: '0', settledAt: instant }] } };
  if ((await request('https://gateway:8443/sale', { method: 'POST', body: sale, tls: true })).status !== 200) fail();
  return { postgres: Number(pg.stdout.trim()), storageRoundTrip, capturedMail: inbox.total,
    fiscalCalls: JSON.parse(fiscal.body).calls, sales: JSON.parse((await request('https://gateway:8443/counts', { tls: true })).body),
    integrity: JSON.parse((await request('https://gateway:8443/verify', { tls: true })).body) };
}
smoke().then(value => process.stdout.write(JSON.stringify(value)), () => { process.exitCode = 1; });
