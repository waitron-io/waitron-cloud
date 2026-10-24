import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dropping the private runtime record hides the only child-level evidence before cleanup.
for (const fault of ['gateway-dns', 'gateway-missing', 'gateway-private', 'gateway-extra', 'gateway-invalid-exit',
  'gateway-invalid-signal', 'gateway-invalid-code', 'gateway-invalid-stage', 'gateway-malformed', 'gateway-oversized', 'gateway-public', 'gateway-link', 'gateway-hardlink', 'gateway-fifo', 'gateway-linked-state', 'gateway-owner']) {
  test(`failed gateway isolation retains only valid runtime evidence: ${fault}`, t => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-gateway-parent-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [new URL('./fixtures/stack-startup-diagnostic-probe.mjs', import.meta.url).pathname, fault, 'false', root], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.removed, true);
    assert.equal(output.diagnostic.stage, 'isolation');
    assert.equal(output.diagnostic.command, 'outbound-canary');
    assert.equal(output.diagnostic.exitCode, 1);
    assert.equal(output.diagnostic.container.role, 'gateway');
    if (fault === 'gateway-dns') assert.deepEqual(output.diagnostic.container.runtime, { stage: 'binary', reason: 'dns-resolution', exitCode: 1 });
    else assert.equal(output.diagnostic.container.runtime, undefined);
    assert.ok(output.events.indexOf('runtime') < output.events.indexOf('state'));
    assert.ok(output.events.indexOf('state') < output.events.indexOf('report'));
    assert.ok(output.events.indexOf('report') < output.events.indexOf('remove'));
    assert.ok(JSON.stringify(output.diagnostic).length < 768);
    assert.equal((result.stdout + result.stderr).includes('PRIVATE_CANARY'), false);
  });
}
