import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Losing the child refusal or forwarding its raw output must fail the runtime boundary.
for (const [fault, reason] of [['dns', 'dns-resolution'], ['split', 'dns-resolution'], ['bind', 'bind'],
  ['tls', 'tls'], ['unknown', 'child-exit'], ['overflow', 'child-exit'], ['late-dns', 'child-exit'],
  ['unicode-limit', 'child-exit'], ['spawn', 'spawn'], ['signal', 'signal']]) {
  test(`gateway retains a private bounded child failure: ${fault}`, t => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-gateway-diagnostic-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [new URL('./fixtures/gateway-runtime-diagnostic-probe.mjs', import.meta.url).pathname, root, fault], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1, result.stderr);
    const file = join(root, 'gateway-failure.json');
    assert.equal(existsSync(file), true, 'retain the child failure before the runtime exits');
    const bytes = readFileSync(file, 'utf8'), value = JSON.parse(bytes);
    assert.equal(value.stage, 'binary');
    assert.equal(value.reason, reason);
    if (fault === 'spawn') assert.equal(value.code, 'ENOENT');
    else if (fault === 'signal') assert.equal(value.signal, 'SIGTERM');
    else assert.equal(value.exitCode, 1);
    assert.ok(bytes.length < 256);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal((bytes + result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
  });
}

for (const fault of ['success', 'record-failure']) test(`gateway diagnostic cannot change child outcome: ${fault}`, t => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-gateway-diagnostic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [new URL('./fixtures/gateway-runtime-diagnostic-probe.mjs', import.meta.url).pathname, root, fault], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, fault === 'success' ? 0 : 1, result.stderr);
  assert.equal(existsSync(join(root, 'gateway-failure.json')), false);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
});
