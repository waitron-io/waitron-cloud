import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { passwordCorpusPath, passwordScreeningFromEnv } from '../src/config.ts';

test('production requires an absolute local compromised-password corpus path', () => {
  assert.throws(() => passwordCorpusPath({NODE_ENV: 'production'}), /Invalid compromised-password configuration/);
  for (const value of ['passwords.sha256', 'https://passwords.example/corpus', '']) {
    assert.throws(() => passwordCorpusPath({NODE_ENV: 'production', CLOUD_COMPROMISED_PASSWORD_CORPUS: value}), /Invalid compromised-password configuration/);
  }
  assert.equal(passwordCorpusPath({NODE_ENV: 'production', CLOUD_COMPROMISED_PASSWORD_CORPUS: '/run/secrets/passwords.sha256'}), '/run/secrets/passwords.sha256');
  assert.equal(passwordCorpusPath({NODE_ENV: 'development'}), undefined);
});

test('configured password screening loads the local corpus used by account completion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-password-config-'));
  try {
    const path = join(directory, 'passwords.sha256');
    await writeFile(path, '4c8cedbb987d3e89dad7e6037531a6ecbcc5d3c593092e4b5a2a3de37dfaf103\n');
    const screening = await passwordScreeningFromEnv({NODE_ENV: 'production', CLOUD_COMPROMISED_PASSWORD_CORPUS: path});
    assert.equal(await screening?.check('a compromised café password'), 'compromised');
    assert.equal(await screening?.check('an acceptable café password'), 'acceptable');
    assert.equal(await passwordScreeningFromEnv({NODE_ENV: 'development'}), undefined);
  } finally { await rm(directory, {recursive: true, force: true}); }
});
