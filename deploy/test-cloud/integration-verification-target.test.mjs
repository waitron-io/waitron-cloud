import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {backupVerificationTargetDigests} from '../../packages/backups/src/verification-protocol.ts';

const pinned = JSON.parse(await readFile(new URL('../backup-verifier/target.json', import.meta.url), 'utf8'));
const revision = '3ff92a10a52953d51402952ccce45550575e514c';
const native = structuredClone(pinned);
native.runtime = {...native.runtime, revision, release: 'waitron-' + revision};
Object.assign(native, backupVerificationTargetDigests(native));
const load = async () => {
  try {return await import('./test-fixtures/integration-verification-target.mjs');}
  catch (error) {if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;}
};

test('ordinary integration keeps the pinned verification target', async () => {
  const {selectIntegrationVerificationTarget: select} = await load();
  assert.equal(typeof select, 'function', 'integration target selector is missing');
  assert.deepEqual(select({revision: pinned.runtime.revision, pinnedTarget: pinned}), pinned);
});

test('explicit newer integration uses the native target from that exact revision', async () => {
  const {selectIntegrationVerificationTarget: select} = await load();
  assert.equal(typeof select, 'function', 'integration target selector is missing');
  assert.deepEqual(select({revision, pinnedTarget: pinned, nativeTarget: native}), native);
});

for (const [name, change] of [
  ['missing native target', value => {delete value.nativeTarget;}],
  ['wrong revision', value => {value.nativeTarget = pinned;}],
  ['malformed selected revision', value => {value.revision = 'main';}],
  ['changed target digest', value => {value.nativeTarget.digest = '0'.repeat(64);}],
  ['changed module policy', value => {value.nativeTarget.modules[0].policyDigest = '0'.repeat(64);}],
]) test('explicit integration refuses ' + name, async () => {
  const {selectIntegrationVerificationTarget: select} = await load();
  assert.equal(typeof select, 'function', 'integration target selector is missing');
  const input = {revision, pinnedTarget: pinned, nativeTarget: structuredClone(native)};
  change(input);
  assert.throws(() => select(input));
});
