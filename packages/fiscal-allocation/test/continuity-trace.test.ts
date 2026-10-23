import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fixture from './continuity-fixture.ts';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PoolClient } from 'pg';
import { fenceWriter, requireCurrentHistory, projectHistory } from '../src/continuity.ts';
import { reserve, scope } from './fixtures.ts';

// Removing stage emission, witness age tracking or result redaction must fail these checks.
test('continuity stages are emitted immediately with elapsed and witness ages', t => {
  assert.equal(typeof fixture.continuityTrace, 'function', 'the fixture needs timing diagnostics');
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  t.mock.method(Date, 'now', () => 1000);
  const lines: string[] = [];
  const mark = fixture.continuityTrace('expired-witness', line => lines.push(line));
  mark('verification-start');
  assert.equal(lines.length, 1, 'a stalled next stage must leave its preceding diagnostic');
  now = 120;
  mark('witness-verified', { observedAt: new Date(990).toISOString() });
  now = 155;
  mark('projection-client-acquired');
  now = 160;
  mark('lock-observation', { waiting: false });
  const records = lines.map(line => JSON.parse(line));
  assert.deepEqual(records, [
    { continuity: 'expired-witness', stage: 'verification-start', elapsedMs: 0 },
    { continuity: 'expired-witness', stage: 'witness-verified', elapsedMs: 20, sinceVerifiedMs: 0, witnessAgeMs: 10 },
    { continuity: 'expired-witness', stage: 'projection-client-acquired', elapsedMs: 55, sinceVerifiedMs: 35, witnessAgeMs: 45 },
    { continuity: 'expired-witness', stage: 'lock-observation', elapsedMs: 60, sinceVerifiedMs: 40, witnessAgeMs: 50, waiting: false },
  ]);
});

test('worker diagnostics expose known refusal codes and receipt presence without private values', () => {
  assert.equal(typeof fixture.continuityTrace, 'function', 'the fixture needs result diagnostics');
  const lines: string[] = [];
  const mark = fixture.continuityTrace('replacement-writer', line => lines.push(line));
  mark('worker-result', { result: { code: 'history_uncertain', receipt: { secret: 'private receipt' } } });
  const unexpected = { code: 'private provider error', token: 'private token' };
  mark('worker-result', { result: unexpected });
  const records = lines.map(line => JSON.parse(line));
  assert.equal(records[0].code, 'history_uncertain');
  assert.equal(records[0].receipt, true);
  assert.equal(records[1].code, 'unknown');
  assert.equal(records[1].receipt, false);
  assert.equal(lines.join('').includes('private'), false);
});

test('a broken diagnostic sink cannot change a worker outcome or throw into a test', () => {
  assert.equal(typeof fixture.continuityTrace, 'function', 'the fixture needs non-throwing diagnostics');
  const mark = fixture.continuityTrace('old-backup', () => { throw Error('sink failed'); });
  assert.doesNotThrow(() => mark('dump-start'));
  assert.doesNotThrow(() => mark('worker-result', { result: { code: 'history_uncertain' } }));
});

test('default continuity diagnostics reach stderr before the next operation starts', () => {
  const source = `import { continuityTrace } from ${JSON.stringify(new URL('./continuity-fixture.ts', import.meta.url).href)};
    continuityTrace('old-backup')('dump-start');`;
  // Capture the child stderr independently of its successful stdout/exit.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.trim(), 'missing continuity diagnostic on stderr');
  const record = JSON.parse(result.stderr);
  assert.equal(record.stage, 'dump-start');
  assert.equal(record.continuity, 'old-backup');
  assert.ok(record.elapsedMs >= 0);
});

test('a genuine fenced worker refusal is recorded without reading an absent receipt', async () => {
  const a = await fixture.authorityFixture();
  const lines: string[] = [];
  const mark = fixture.continuityTrace('replacement-writer', line => lines.push(line));
  try {
    const original = await a.worker('fence', {});
    await a.worker('fence', {});
    const result = await a.worker('reserve', { input: reserve(), accountId: randomUUID(), grant: original.grant });
    mark('replacement-worker-result', { result });
    assert.equal(result.code, 'history_uncertain');
    assert.equal(result.receipt, undefined);
    assert.equal(JSON.parse(lines[0]!).code, 'history_uncertain');
    assert.equal(JSON.parse(lines[0]!).receipt, false);
  } finally { await a.close(); }
});

test('early witness expiry reports refusal before a database lock can be reached', async () => {
  const a = await fixture.authorityFixture();
  const lines: string[] = [];
  const mark = fixture.continuityTrace('expired-witness', line => lines.push(line));
  try {
    const authority = a.adapter();
    const shorter = { ...authority, verification: { ...authority.verification, policy: { ...authority.verification.policy, witnessMaxAgeMs: 150 } } };
    const grant = await fenceWriter(authority, scope);
    mark('verification-start');
    const history = await requireCurrentHistory(shorter, scope, grant);
    mark('witness-verified', { observedAt: history.witness.observedAt });
    await delay(200);
    let queried = false;
    const client = { query: async () => { queried = true; throw Error('database should not be reached'); } } as unknown as PoolClient;
    await assert.rejects(projectHistory(client, history), error => {
      mark('projection-refused', { result: error as { code?: unknown } });
      return (error as { code?: string }).code === 'history_uncertain';
    });
    assert.equal(queried, false);
    const refused = JSON.parse(lines.at(-1)!);
    assert.equal(refused.code, 'history_uncertain');
    assert.ok(refused.sinceVerifiedMs >= 150);
    assert.ok(refused.witnessAgeMs >= 150);
  } finally { await a.close(); }
});
