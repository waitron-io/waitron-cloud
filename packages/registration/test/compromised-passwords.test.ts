import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { LocalPasswordCorpus } from '../src/compromised-passwords.ts';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function corpus(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-password-corpus-'));
  directories.push(directory);
  const path = join(directory, 'passwords.sha256');
  await writeFile(path, contents);
  return path;
}

test('local corpus matches UTF-8 passwords by SHA-256 digest without retaining plaintext', async () => {
  const path = await corpus('# one lowercase SHA-256 digest per line\n4c8cedbb987d3e89dad7e6037531a6ecbcc5d3c593092e4b5a2a3de37dfaf103\n');
  const screening = await LocalPasswordCorpus.load(path);
  assert.equal(await screening.check('a compromised café password'), 'compromised');
  assert.equal(await screening.check('an acceptable café password'), 'acceptable');
  assert.ok(!JSON.stringify(screening).includes('a compromised café password'));
});

test('local corpus refuses malformed and oversized inputs with no submitted corpus text in the error', async () => {
  const malformed = await corpus(`4c8cedbb987d3e89dad7e6037531a6ecbcc5d3c593092e4b5a2a3de37dfaf103\nprivate-corpus-sentinel\n`);
  await assert.rejects(LocalPasswordCorpus.load(malformed), error => {
    assert.equal(error instanceof Error && error.message, 'Invalid compromised-password corpus');
    assert.ok(!String(error).includes('private-corpus-sentinel'));
    return true;
  });
  const oversized = await corpus(`${'a'.repeat(129)}\n`);
  await assert.rejects(LocalPasswordCorpus.load(oversized, {maxBytes: 128}), /Invalid compromised-password corpus/);
  await assert.rejects(LocalPasswordCorpus.load(await corpus('# no active entries\n')), /Invalid compromised-password corpus/);
});
