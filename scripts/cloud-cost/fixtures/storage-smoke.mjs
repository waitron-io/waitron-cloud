// Synthetic inputs only. HTTP bodies stay here; output contains counts and fixed result codes.
import { request } from 'node:http';
const call = (port, method, path, body = '') => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, method, path, headers: { 'content-length': Buffer.byteLength(body) } }, res => {
    const parts = []; let bytes = 0;
    res.on('data', b => { bytes += b.length; parts.push(b); });
    res.on('error', reject);
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString(), bytes }));
  });
  req.setTimeout(3000, () => req.destroy(Error('Synthetic storage timeout')));
  req.on('error', reject); req.end(body);
});
async function smoke() {
  let baseline;
  try { baseline = JSON.parse((await call(8335, 'GET', '/snapshot')).text); }
  catch { return { ready: false }; }
  if ((await call(8335, 'POST', '/phase', JSON.stringify({ phase: 'workload' }))).status !== 200) return { ready: false };
  const producer = { attempts: 0, bytesIn: 0, bytesOut: 0 };
  const observed = [];
  const run = async (method, path, body, expectedStatus) => {
    const result = await call(8333, method, path, body);
    if (result.status !== expectedStatus) throw Error('Synthetic storage response');
    producer.attempts++; producer.bytesIn += result.bytes; producer.bytesOut += Buffer.byteLength(body ?? '');
    return result;
  };
  await run('PUT', '/synthetic-meter', '', 200);
  await run('PUT', '/synthetic-meter/private-object?x-id=PutObject', 'abcdef', 200);
  const read = await run('GET', '/synthetic-meter/private-object', '', 200);
  if (read.text !== 'abcdef') throw Error('Synthetic storage contents');
  await run('HEAD', '/synthetic-meter/private-object', '', 200);
  await run('GET', '/synthetic-meter?list-type=2', '', 200);
  const upload = await run('POST', '/synthetic-meter/private-part?uploads', '', 200);
  const id = upload.text.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!id) throw Error('Synthetic multipart id');
  const query = 'uploadId=' + encodeURIComponent(id);
  await run('PUT', '/synthetic-meter/private-part?' + query + '&partNumber=1', 'part', 200);
  await run('GET', '/synthetic-meter/private-part?' + query, '', 200);
  await run('DELETE', '/synthetic-meter/private-part?' + query, '', 204);
  await run('DELETE', '/synthetic-meter/private-object', '', 204);
  await run('DELETE', '/synthetic-meter', '', 204);
  const snapshot = JSON.parse((await call(8335, 'GET', '/snapshot')).text);
  for (const row of snapshot.observedRequests.filter(r => r.phase === 'workload')) observed.push(row);
  const refusedPhase = (await call(8335, 'POST', '/phase', JSON.stringify({ phase: 'unknown' }))).status;
  const refusedExtraPhase = (await call(8335, 'POST', '/phase', JSON.stringify({ phase: 'idle', raw: 'PRIVATE_SYNTHETIC_CANARY' }))).status;
  const refusedOperation = (await call(8333, 'POST', '/synthetic-meter?delete')).status;
  const invalidSnapshot = (await call(8335, 'GET', '/snapshot')).status;
  return { ready: true, producer, observer: Object.fromEntries(Object.entries(producer).map(([k]) => [k,
    snapshot.accounting.observer[k] - baseline.accounting.observer[k]])),
    status: snapshot.status, reconciled: snapshot.reconciled, observed,
    refusedPhase, refusedExtraPhase, refusedOperation, invalidSnapshot,
    leaked: /synthetic-meter|private-object|private-part|UploadId|uploadId/.test(JSON.stringify(snapshot)) };
}
smoke().then(v => process.stdout.write(JSON.stringify(v)), () => { process.exitCode = 1; });
