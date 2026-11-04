import assert from 'node:assert/strict';
import {generateKeyPairSync, createPrivateKey, createHash, randomUUID, randomInt, sign} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {request} from 'node:https';
import {parseRecoveryKit} from '/waitron/packages/stream/src/kit.ts';

const root = '/tmp/cloud-integration-continuous-target', origin = 'https://waitron.local:3000';
let text = ''; for await (const part of process.stdin) {text += part; assert(text.length < 16384);}
const input = JSON.parse(text);
await mkdir(root, {recursive: true, mode: 0o700});
if (input.phase === 'start') {
  const keys = generateKeyPairSync('ed25519');
  await writeFile(root + '/identity.json', JSON.stringify({id: randomUUID(), code: String(randomInt(10000000, 100000000)),
    publicKey: keys.publicKey.export({type: 'spki', format: 'der'}).toString('base64url'),
    privateKey: keys.privateKey.export({type: 'pkcs8', format: 'der'}).toString('base64url')}), {mode: 0o600});
  await writeFile(root + '/ca.pem', input.ca, {mode: 0o600});
}
const identity = JSON.parse(await readFile(root + '/identity.json', 'utf8'));
const key = createPrivateKey({key: Buffer.from(identity.privateKey, 'base64url'), type: 'pkcs8', format: 'der'});
const ca = await readFile(root + '/ca.pem');
const post = async (action, values, includeId = false) => {
  const bytes = Buffer.from(JSON.stringify(values));
  const body = JSON.stringify({...(includeId ? {id: identity.id} : {}), payload: bytes.toString('base64url'), signature: sign(null, bytes, key).toString('base64url')});
  return new Promise((resolve, reject) => {
    const req = request({hostname: 'proxy', port: 3000, servername: 'waitron.local', ca,
      path: '/api/recovery/' + action, method: 'POST', headers: {host: 'waitron.local:3000', 'content-type': 'application/json'}}, res => {
      let output = ''; res.on('data', part => {output += part; if (output.length > 65536) req.destroy(Error('integration.continuous_reply_large'));});
      res.once('error', reject); res.once('end', () => {
        try {assert.equal(res.statusCode, 200, 'integration.continuous_' + action); resolve(JSON.parse(output));} catch (error) {reject(error);}
      });
    });
    req.once('error', reject); req.setTimeout(10000, () => req.destroy(Error('integration.continuous_api_timeout'))); req.end(body);
  });
};
const status = action => post(action, ['waitron-cloud-recovery-request-v1', origin, identity.id, action, identity.publicKey, identity.code, Date.now()]);
const target = (action, digest = '') => post(action, ['waitron-cloud-recovery-v1', origin, identity.id, action, digest, Date.now()], true);
if (input.phase === 'start') {
  assert.equal((await status('start')).state, 'awaiting_owner');
  console.log(JSON.stringify({requestId: identity.id, code: identity.code}));
} else {
  assert.equal(input.phase, 'read');
  const approved = await status('status');
  assert.equal(approved.state, 'approved'); assert.equal(approved.operationId, identity.id);
  const info = await target('info');
  assert.equal(info.source.kind, 'continuous');
  assert.equal(info.source.sourceNodeId, input.selected.sourceNodeId);
  assert.equal(info.source.recoverableAt, input.selected.recoverableAt);
  const digest = createHash('sha256').update('waitron-cloud-stream-generation-v1\0' + input.selected.generation).digest('hex');
  assert.equal(info.source.sourceDigest, digest);
  const access = await target('read', digest);
  assert.deepEqual(access.source, info.source);
  const kit = parseRecoveryKit(access.recoveryKit);
  assert.equal(kit.venueId, input.selected.localVenueId);
  assert.equal(kit.bucket.prefix, 'streams/' + input.selected.venueId + '/');
  assert.equal(kit.bucket.bucket, 'venue-' + input.selected.venueId);
  await writeFile('/tmp/cloud-integration-stream-input.json', JSON.stringify({kit: access.recoveryKit,
    authority: input.authority, selected: input.selected}), {mode: 0o600});
  console.log(JSON.stringify({ownerApprovedKit: true, sourceNodeId: info.source.sourceNodeId}));
}
