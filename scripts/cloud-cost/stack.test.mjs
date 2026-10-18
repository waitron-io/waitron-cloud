import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as local from './local.mjs';

function fixture(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'cloud-cost-stack-test-')));
  const source = join(parent, 'source'), root = join(parent, 'owned');
  mkdirSync(source, { mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const codeRoot = join(root, 'code'), stateRoot = join(root, 'state');
  mkdirSync(codeRoot, { mode: 0o700 }); mkdirSync(stateRoot, { mode: 0o700 });
  const token = randomBytes(32).toString('hex'), path = join(root, 'journal.json');
  writeFileSync(join(root, '.cloud-cost-owner'), token, { mode: 0o600 });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, source, root, ownershipToken: token }), { mode: 0o600 });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { source, root, codeRoot, stateRoot, journal: { path, token }, image: 'sha256:' + 'c'.repeat(64) };
}

// A missing isolation option, floating image, broad mount or host publication must not reach Docker.
test('preparedStackPinsEveryServiceAndKeepsAllStatePrivate', t => {
  assert.equal(typeof local.prepareIsolatedStack, 'function', 'implement the prepared service boundary');
  const f = fixture(t), prepared = local.prepareIsolatedStack(f);
  const config = JSON.parse(execFileSync('docker', ['compose', '-f', prepared.file, 'config', '--format', 'json'],
    { env: { PATH: process.env.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.deepEqual(Object.keys(config.services).sort(), ['fiscal', 'gateway', 'mailpit', 'postgres', 's3', 'waitron']);
  assert.equal(config.networks.isolated.internal, true);
  assert.equal(config.networks.isolated.labels['io.waitron.cloud-cost.owner'], f.journal.token);
  for (const [role, service] of Object.entries(config.services)) {
    assert.equal(service.image, f.image);
    assert.equal(service.pull_policy, 'never');
    assert.equal(service.read_only, true);
    assert.equal(service.logging.driver, 'none');
    assert.deepEqual(service.dns, ['127.0.0.1']);
    assert.deepEqual(Object.keys(service.networks), ['isolated']);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.ok(!service.privileged);
    assert.ok(!service.environment);
    assert.ok(!service.extra_hosts);
    assert.ok(!service.volumes_from);
    assert.ok(!service.build);
    assert.equal(service.labels['io.waitron.cloud-cost.owner'], f.journal.token);
    assert.equal(service.labels['io.waitron.cloud-cost.role'], role);
    assert.deepEqual(service.volumes.map(v => [v.type, v.source, v.target, !!v.read_only]),
      [['bind', f.codeRoot, '/code', true], ['bind', f.stateRoot, '/state', false]]);
    for (const port of service.ports ?? []) {
      assert.equal(role, 'gateway'); assert.equal(port.host_ip, '127.0.0.1');
      assert.equal(Number(port.published), 0, 'Docker must choose an unused loopback port');
    }
  }
  const journal = JSON.parse(readFileSync(f.journal.path, 'utf8'));
  assert.ok(journal.localResources.some(r => r.kind === 'compose-plan' && r.state === 'ready' && r.path === prepared.file));
});
test('preparedStackRefusesFloatingImagesOverlapAndLinkedMounts', t => {
  assert.equal(typeof local.prepareIsolatedStack, 'function', 'validate before generating Docker inputs');
  for (const change of [
    f => ({ image: 'node:26' }),
    f => ({ image: 'sha256:' + 'g'.repeat(64) }),
    f => ({ codeRoot: f.source }),
    f => ({ stateRoot: f.codeRoot }),
    f => { writeFileSync(join(f.root, '.cloud-cost-owner'), '0'.repeat(64)); return {}; },
    f => { const alias = join(f.root, 'alias'); symlinkSync(f.source, alias); return { stateRoot: alias }; },
  ]) {
    const f = fixture(t);
    assert.throws(() => local.prepareIsolatedStack({ ...f, ...change(f) }), /Invalid cloud cost local run/);
    assert.equal(JSON.parse(readFileSync(f.journal.path, 'utf8')).localResources, undefined);
  }
});
