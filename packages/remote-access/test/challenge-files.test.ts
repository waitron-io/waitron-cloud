import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import forge from 'node-forge';
import {readChallengeFolder} from '../src/challenge-files.ts';
import {challengeCertificate} from './fixtures/challenge-certificate.ts';

const now = 100_000;
const hostname = 'staff.example.test';

async function setup(t: {after: (fn: () => Promise<void>) => void}) {
  const folder = await mkdtemp(join(tmpdir(), 'cloud-check-files-'));
  t.after(() => rm(folder, {recursive: true, force: true}));
  const check = await challengeCertificate(hostname, now + 1);
  const put = (value: unknown, name = hostname) => writeFile(join(folder, name + '.json'), JSON.stringify(value));
  return {folder, check, put};
}

function readChecks(folder: string, names = new Set([hostname])) {
  return readChallengeFolder(folder, names, now);
}

test('loads an unexpired check for the current route while ignoring a file for another route', async t => {
  const {folder, check, put} = await setup(t);
  await put(check);
  const other = await challengeCertificate('other.example.test', now + 1);
  await put(other, other.hostname);
  assert.deepEqual([...await readChecks(folder)].map(([name]) => name), [hostname]);
  assert.equal((await readChecks(join(folder, 'missing'))).size, 0);
  const names = new Set([hostname, ...Array.from({length: 127}, (_, i) => `route-${i}.example.test`), other.hostname]);
  assert.deepEqual([...await readChecks(folder, names)].map(([name]) => name), [hostname]);
});

test('a route whose file name exceeds the filesystem limit does not block other checks', async t => {
  const {folder, check, put} = await setup(t);
  await put(check);
  const longName = [63, 63, 63, 61].map(length => 'a'.repeat(length)).join('.');
  assert.deepEqual([...await readChecks(folder, new Set([longName, hostname]))].map(([name]) => name), [hostname]);
});

test('refuses invalid files while retaining the neighbouring check', async t => {
  const {folder, check, put} = await setup(t);
  const other = await challengeCertificate('other.example.test', now + 1);
  await put(other, other.hostname);
  const read = () => readChecks(folder, new Set([hostname, other.hostname]));
  const cases = {
    expired: {...check, expiresAt: now},
    wrongFilename: other,
    extraField: {...check, extra: true},
    mismatchedKey: {...check, key: other.key},
    wrongCertificateName: {...check, key: other.key, certificate: other.certificate},
    oversized: {...check, certificate: check.certificate + ' '.repeat(16_384)},
  };
  for (const [label, value] of Object.entries(cases)) {
    await put(value);
    assert.deepEqual([...await read()].map(([name]) => name), [other.hostname], label);
  }
});

test('requires the critical identifier extension itself, with a 32-byte digest', async t => {
  const {folder, put} = await setup(t);
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.setSubject([{name: 'commonName', value: hostname}]);
  cert.setIssuer(cert.subject.attributes);
  const id = '1.3.6.1.5.5.7.1.31';
  const digest = '\x04\x20' + '\0'.repeat(32);
  for (const [label, extension] of Object.entries({
    nonCritical: {id, value: digest},
    shortDigest: {id, critical: true, value: '\x04\x1f' + '\0'.repeat(31)},
    embedded: {id: '1.2.3.4', value: '\x30\x31\x06\x08\x2b\x06\x01\x05\x05\x07\x01\x1f\x01\x01\xff\x04\x22' + digest},
    valid: {id, critical: true, value: digest},
    extraName: {id, critical: true, value: digest},
  })) {
    const altNames = [{type: 2, value: hostname}];
    if (label === 'extraName') altNames.push({type: 2, value: 'extra.example.test'});
    cert.setExtensions([{name: 'subjectAltName', altNames}, extension]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    await put({hostname, expiresAt: now + 1, certificate: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey)});
    assert.equal((await readChecks(folder)).has(hostname), label === 'valid', label);
  }
});

test('a symlink and FIFO cannot supply or stall a check', async t => {
  const {folder, check, put} = await setup(t);
  await put(check, 'stand-in');
  const filename = join(folder, hostname + '.json');
  await symlink('stand-in.json', filename);
  assert.equal((await readChecks(folder)).size, 0);
  await rm(filename);
  execFileSync('mkfifo', [filename]);
  // A blocked open can outlive Node's in-process test timeout.
  const reader = new URL('../src/challenge-files.ts', import.meta.url).href;
  const size = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {readChallengeFolder} from ${JSON.stringify(reader)};
    const [folder, name] = process.argv.slice(1);
    console.log((await readChallengeFolder(folder, new Set([name]), ${now})).size);
  `, folder, hostname], {encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL'});
  assert.equal(size.trim(), '0');
});
