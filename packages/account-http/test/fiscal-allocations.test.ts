import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, createHash, createPrivateKey, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { blocked } from '../../fiscal-allocation/test/store-fixture.ts';
import { retain } from '../../fiscal-allocation/test/continuity-fixture.ts';
import { hashSecret, encryptFactorSecret } from '@waitron-cloud/identity';
import { PasswordLoginStore } from '@waitron-cloud/registration';
import { canonical, paperSigningBytes } from '../../fiscal-allocation/src/evidence.ts';
import { key, bases, binding, scope } from '../../fiscal-allocation/test/fixtures.ts';

import { fiscalHttpFixture as fixture } from './fiscal-http-fixture.ts';
const origin = 'http://localhost';
const prefix = '/api/account/fiscal-allocations/';
async function refusal(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.getSetCookie().length, 0);
}

test('real HTTP reserve, consume, passive status and list retain the exact signed bindings', async () => {
  const s = await fixture();
  try {
    const response = await s.request('reserve', s.v.input);
    assert.equal(response.status, 200);
    const r = await response.json();
    assert.equal(r.payload.allocation.installationIdentity, 'C000001');
    assert.deepEqual(r.payload.binding, s.v.input.binding);
    assert.equal(r.payload.cloudAccountId, s.v.account);
    assert.deepEqual(await (await s.request('reserve', s.v.input)).json(), r);
    const input = {
      version: 1,
      operationId: randomUUID(),
      allocationId: r.payload.allocation.allocationId,
      binding: s.v.input.binding,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: new Date().toISOString(),
    };
    const consumed = await s.request('consume', input);
    assert.equal(consumed.status, 200);
    const c = await consumed.json();
    assert.equal(c.payload.state, 'consumed');
    assert.deepEqual(c.payload.allocation, r.payload.allocation);
    assert.deepEqual(
      await (
        await s.request('status', {
          version: 1,
          venueId: s.v.id,
          operationId: input.operationId,
        })
      ).json(),
      { version: 1, state: 'recorded', receipt: c },
    );
    assert.deepEqual(
      await (
        await s.request('list', {
          version: 1,
          venueId: s.v.id,
          cursor: null,
          limit: 50,
        })
      ).json(),
      { version: 1, items: [c], nextCursor: null },
    );
  } finally {
    await s.close();
  }
});
test('disabled fiscal routes refuse with 503 without claiming any name', async () => {
  const s = await fixture(false);
  try {
    await refusal(await s.request('reserve', s.v.input), 503, 'continuity_unavailable');
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_events')).rows[0].n,
      0,
    );
  } finally {
    await s.close();
  }
});
for (const [name, options, status, error] of [
  ['host', { headers: { host: 'other.example' } }, 403, 'forbidden'],
  ['origin', { headers: { origin: 'http://other.example' } }, 403, 'forbidden'],
  ['method', { method: 'GET' }, 405, 'method_not_allowed'],
  ['content type', { headers: { 'content-type': 'text/plain' } }, 415, 'invalid_input'],
  ['compressed body', { headers: { 'content-encoding': 'gzip' } }, 415, 'invalid_input'],
  ['oversize body', { raw: JSON.stringify({ data: 'x'.repeat(16384) }) }, 413, 'invalid_input'],
  ['unknown field', { raw: JSON.stringify({ unexpected: true }) }, 400, 'invalid_input'],
  ['session', { headers: { cookie: '' } }, 401, 'unauthenticated'],
  ['CSRF', { headers: { 'x-csrf-token': 'incorrect' } }, 403, 'forbidden'],
] as const)
  test(`real fiscal HTTP refuses wrong ${name} before external claims`, async () => {
    const s = await fixture();
    try {
      await refusal(await s.request('reserve', s.v.input, options), status, error);
      assert.equal(
        (
          await s.a.request('history', {
            scope: s.v.input.scope,
            afterSequence: '0',
            nonce: 'test',
          })
        ).events.length,
        0,
      );
    } finally {
      await s.close();
    }
  });
test('two HTTP listeners share the ten-per-minute authorized taxpayer budget', async () => {
  const s = await fixture();
  try {
    const other = await s.server();
    for (let n = 0; n < 10; n++)
      assert.equal(
        (
          await s.request('reserve', s.v.input, {
            port: n % 2 ? other : s.port,
          })
        ).status,
        200,
      );
    const denied = await s.request('reserve', s.v.input, { port: other });
    assert.equal(denied.status, 429);
    assert.deepEqual(await denied.json(), { error: 'rate_limited' });
    assert.ok(Number(denied.headers.get('retry-after')) > 0);
    assert.equal(
      (
        await s.a.request('history', {
          scope: s.v.input.scope,
          afterSequence: '0',
          nonce: 'test',
        })
      ).events.length,
      1,
    );
  } finally {
    await s.close();
  }
});
test('unauthenticated and foreign-venue attempts cannot spend a taxpayer budget', async () => {
  const s = await fixture();
  try {
    const foreign = await s.venue();
    for (let n = 0; n < 11; n++) {
      await refusal(
        await s.request('reserve', s.v.input, { headers: { cookie: '' } }),
        401,
        'unauthenticated',
      );
      await refusal(await s.request('reserve', foreign.input), 403, 'permission_denied');
    }
    assert.equal((await s.request('reserve', s.v.input)).status, 200);
  } finally {
    await s.close();
  }
});
test('external append survives a discarded real TCP response and status after listener and authority restart', async () => {
  const s = await fixture();
  try {
    const raw = JSON.stringify(s.v.input);
    const request = httpRequest({
      host: '127.0.0.1',
      port: s.port,
      path: prefix + 'reserve',
      method: 'POST',
      headers: {
        host: 'localhost',
        origin,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(raw),
        cookie: `cloud_session=${s.v.session.token}`,
        'x-csrf-token': s.v.session.csrfToken,
      },
    });
    await new Promise<void>((resolve, reject) => {
      request.once('error', reject);
      request.once('response', (response) => {
        response.destroy();
        resolve();
      });
      request.end(raw);
    });
    await s.a.restart();
    const restarted = await s.server();
    const response = await s.request(
      'status',
      { version: 1, venueId: s.v.id, operationId: s.v.input.operationId },
      { port: restarted },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.state, 'recorded');
    assert.equal(result.receipt.payload.allocation.installationIdentity, 'C000001');
    assert.deepEqual(
      await (await s.request('reserve', s.v.input, { port: restarted })).json(),
      result.receipt,
    );
    await retain('task4-http-lost-reply-proof', {
      result,
      externalEvents: (
        await s.a.request('history', {
          scope: s.v.input.scope,
          afterSequence: '0',
          nonce: 'test',
        })
      ).events,
    });
  } finally {
    await s.close();
  }
});
test('pending authenticator challenge cannot authorize fiscal cookies but the full session can', async () => {
  const s = await fixture();
  try {
    const password = 'A distinct account password',
      keys = { activeKeyId: 'factor', keys: { factor: 'ab'.repeat(32) } };
    const email = (
      await s.f.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1', [s.v.account])
    ).rows[0].email;
    await s.f.pool.query('UPDATE cloud_credentials SET password_hash=$2 WHERE account_id=$1', [
      s.v.account,
      await hashSecret(password),
    ]);
    const envelope = encryptFactorSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', keys, {
      accountId: s.v.account,
      version: 1,
      purpose: 'active',
    });
    await s.f.pool.query(
      'INSERT INTO cloud_authenticator_factors(account_id,version,secret_generation,secret_envelope) VALUES($1,1,$2,$3)',
      [s.v.account, randomUUID(), envelope],
    );
    const result = await new PasswordLoginStore(s.f.pool, keys, {
      loginLifetimeMs: 300000,
      challengeAttempts: 10,
    }).start({ email, password });
    assert.equal(result.kind, 'factor');
    if (result.kind !== 'factor') throw Error('expected challenge');
    await refusal(
      await s.request('reserve', s.v.input, {
        headers: {
          cookie: `cloud_session=${result.challengeToken}`,
          'x-csrf-token': result.challengeToken,
        },
      }),
      401,
      'unauthenticated',
    );
    assert.equal((await s.request('reserve', s.v.input)).status, 200);
  } finally {
    await s.close();
  }
});
test('status recovers first reservation missing from PostgreSQL after durable append and real COMMIT failure', async () => {
  const s = await fixture();
  try {
    await s.f.pool.query(
      'CREATE TABLE fiscal_commit_parent(id integer PRIMARY KEY); CREATE TABLE fiscal_commit_child(id integer REFERENCES fiscal_commit_parent DEFERRABLE INITIALLY DEFERRED)',
    );
    await s.f.pool
      .query(`CREATE FUNCTION fiscal_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO fiscal_commit_child VALUES(1); RETURN NEW; END $$;
      CREATE TRIGGER fiscal_fail_commit AFTER INSERT ON fiscal_registry_events FOR EACH ROW EXECUTE FUNCTION fiscal_fail_commit()`);
    await refusal(await s.request('reserve', s.v.input), 503, 'temporarily_unavailable');
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_events')).rows[0].n,
      0,
    );
    const events = (
      await s.a.request('history', {
        scope: s.v.input.scope,
        afterSequence: '0',
        nonce: 'test',
      })
    ).events;
    assert.equal(events.length, 1);
    assert.equal(events[0].receipt.payload.allocation.installationIdentity, 'C000001');
    await s.f.pool.query('DROP TRIGGER fiscal_fail_commit ON fiscal_registry_events');
    await s.a.restart();
    const restarted = await s.server();
    const response = await s.request(
      'status',
      { version: 1, venueId: s.v.id, operationId: s.v.input.operationId },
      { port: restarted },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, {
      version: 1,
      state: 'recorded',
      receipt: events[0].receipt,
    });
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0]
        .n,
      1,
    );
    await retain('task4-http-failed-commit-proof', { events, result });
  } finally {
    await s.close();
  }
});
async function consumed(s: Awaited<ReturnType<typeof fixture>>) {
  const reserve = await s.request('reserve', s.v.input);
  assert.equal(reserve.status, 200);
  const r = await reserve.json();
  const consume = await s.request('consume', {
    version: 1,
    operationId: randomUUID(),
    allocationId: r.payload.allocation.allocationId,
    binding: s.v.input.binding,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: new Date().toISOString(),
  });
  assert.equal(consume.status, 200);
  return consume.json();
}
test('signed machine report matches consumed evidence once without activating or issuing another name', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      body = {
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: {
          eventId: s.v.input.binding.eventId,
          result: 'committed',
        },
      };
    const proof = s.proof(body);
    const response = await s.report(proof);
    assert.equal(response.status, 200);
    const expected = {
      version: 1,
      state: 'matched',
      receiptId: r.payload.receiptId,
    };
    assert.deepEqual(await response.json(), expected);
    await s.a.restart();
    const restarted = await s.server();
    assert.deepEqual(await (await s.report(proof, { port: restarted })).json(), expected);
    const events = (
      await s.a.request('history', {
        scope: s.v.input.scope,
        afterSequence: '0',
        nonce: 'test',
      })
    ).events;
    assert.equal(events.length, 3);
    assert.equal(events[2].action, 'report');
    assert.equal(
      (await s.f.pool.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0]
        .c_high_water,
      1,
    );
    assert.deepEqual(
      await (
        await s.request('list', {
          version: 1,
          venueId: s.v.id,
          cursor: null,
          limit: 50,
        })
      ).json(),
      { version: 1, items: [r], nextCursor: null },
    );
    await refusal(
      await s.request('abandon', {
        version: 1,
        operationId: randomUUID(),
        allocationId: r.payload.allocation.allocationId,
        binding: r.payload.binding,
      }),
      409,
      'binding_conflict',
    );
    await retain('task4-machine-report-proof', { events, result: expected });
  } finally {
    await s.close();
  }
});
for (const [name, change] of [
  ['origin', { origin: 'http://elsewhere' }],
  ['action', { action: 'renew' }],
  ['time', { issuedAt: 0 }],
  ['lease', { lease: '{}' }],
  ['digest', { bodyDigest: 'a'.repeat(64) }],
] as const)
  test(`signed machine report refuses wrong ${name}`, async () => {
    const s = await fixture();
    try {
      const r = await consumed(s),
        body = {
          venueId: s.v.id,
          scope: s.v.input.scope,
          receipt: r,
          paperHistory: null,
          activationEvidence: { result: 'committed' },
        };
      await refusal(await s.report(s.proof(body, change)), 401, 'invalid_proof');
      assert.equal(
        (
          await s.a.request('history', {
            scope: s.v.input.scope,
            afterSequence: '0',
            nonce: 'test',
          })
        ).events.length,
        2,
      );
    } finally {
      await s.close();
    }
  });
test('revoked or replaced installation key refuses even an exact prior machine report', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      });
    assert.equal((await s.report(proof)).status, 200);
    await s.f.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1', [
      s.v.installation,
    ]);
    await refusal(await s.report(proof), 403, 'permission_denied');
    await s.f.pool.query('UPDATE installations SET revoked_at=NULL,public_key=$2 WHERE id=$1', [
      s.v.installation,
      generateKeyPairSync('ed25519')
        .publicKey.export({ type: 'spki', format: 'der' })
        .toString('base64url'),
    ]);
    await refusal(await s.report(proof), 401, 'invalid_proof');
  } finally {
    await s.close();
  }
});
test('changed signed body conflicts with an existing machine report operation', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      body = {
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      };
    const operationId = randomUUID();
    assert.equal((await s.report(s.proof(body, { operationId }))).status, 200);
    await refusal(
      await s.report(
        s.proof({ ...body, activationEvidence: { result: 'uncertain' } }, { operationId }),
      ),
      409,
      'binding_conflict',
    );
  } finally {
    await s.close();
  }
});
test('machine report refuses corrupted signature, foreign venue and both or no evidence sources', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      body = {
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      };
    const proof = s.proof(body);
    await refusal(
      await s.report({
        ...proof,
        signature: Buffer.alloc(64).toString('base64url'),
      }),
      401,
      'invalid_proof',
    );
    await refusal(
      await s.report(s.proof({ ...body, venueId: randomUUID() })),
      401,
      'invalid_proof',
    );
    await refusal(await s.report(s.proof({ ...body, receipt: null })), 401, 'invalid_proof');
    const forged = structuredClone(r);
    forged.payload.custodyVersion = 'forged';
    await refusal(await s.report(s.proof({ ...body, receipt: forged })), 401, 'invalid_proof');
  } finally {
    await s.close();
  }
});
test('matched and conflicting signed paper reports retain outcomes without importing or activating', async () => {
  const s = await fixture();
  try {
    const k = key();
    function signed<T>(payload: T) {
      return {
        payload,
        signature: sign(
          null,
          paperSigningBytes(payload),
          createPrivateKey({
            key: Buffer.from(k.privateKey, 'base64url'),
            type: 'pkcs8',
            format: 'der',
          }),
        ).toString('base64url'),
      };
    }
    const trust = {
      custodianId: 'custodian-1',
      custodyVersion: 'custody-1',
      keys: new Map([[k.keyId, k.publicKey]]),
    };
    const port = await s.server({ ...s.options, paperTrust: trust });
    const block = {
      version: 1 as const,
      custodianId: 'custodian-1',
      generationId: 'generation-1',
      blockId: 'block-1',
      packVersion: 1 as const,
      recipientVenueId: s.v.id,
      allocations: [
        {
          version: 1 as const,
          allocationId: randomUUID(),
          ...scope,
          installationIdentity: 'P000001',
          series: bases.map((b) => ({ ...b, code: b.code + '-P000001' })),
          source: 'paper' as const,
          issuedAt: new Date().toISOString(),
        },
      ],
    };
    const consumption = {
      version: 1 as const,
      custodianId: 'custodian-1',
      blockDigest: createHash('sha256').update(canonical(block)).digest('hex'),
      allocationId: block.allocations[0]!.allocationId,
      ...binding,
      consumedAt: new Date().toISOString(),
    };
    const input = {
      version: 1 as const,
      operationId: randomUUID(),
      venueId: s.v.id,
      scope,
      custodyVersion: 'custody-1',
      registerRevision: '1',
      previousDigest: '0'.repeat(64),
      block: signed(block),
      consumptions: [signed(consumption)],
      transfers: [],
    };
    const imported = await s.request('import-paper', input, { port });
    assert.equal(imported.status, 200);
    const body = {
      venueId: s.v.id,
      scope,
      receipt: null,
      paperHistory: input,
      activationEvidence: { result: 'committed' },
    };
    const matched = await s.report(s.proof(body), { port });
    assert.equal(matched.status, 200);
    assert.deepEqual(await matched.json(), {
      version: 1,
      state: 'matched',
      receiptId: null,
    });
    const changed = {
      ...input,
      consumptions: [signed({ ...consumption, targetNodeId: 'another-node' })],
    };
    const conflicting = await s.report(s.proof({ ...body, paperHistory: changed }), { port });
    assert.equal(conflicting.status, 200);
    assert.deepEqual(await conflicting.json(), {
      version: 1,
      state: 'conflict',
      receiptId: null,
    });
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events')).rows[0]
        .n,
      1,
    );
    assert.equal(
      (await s.f.pool.query('SELECT c_high_water FROM fiscal_registry_scopes')).rows[0]
        .c_high_water,
      0,
    );
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_allocations')).rows[0]
        .n,
      0,
    );
  } finally {
    await s.close();
  }
});
test('a signed machine lease expiring during the namespace wait cannot append a report', async () => {
  const s = await fixture(),
    held = await s.f.pool.connect();
  let outcome: Promise<Response> | undefined;
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      });
    const expiry = Date.now() + 800;
    await s.f.pool.query('UPDATE installations SET lease_expires_at=$2 WHERE id=$1', [
      s.v.installation,
      new Date(expiry),
    ]);
    await held.query('BEGIN');
    await held.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      canonical(['fiscal-namespace', scope]),
    ]);
    outcome = s.report(proof);
    assert.match(await blocked(s.f.pool), /pg_advisory_xact_lock/);
    while (Date.now() <= expiry) await held.query('SELECT clock_timestamp()');
    await held.query('COMMIT');
    await refusal(await outcome, 401, 'invalid_proof');
    assert.equal(
      (
        await s.a.request('history', {
          scope,
          afterSequence: '0',
          nonce: 'test',
        })
      ).events.length,
      2,
    );
  } finally {
    await held.query('ROLLBACK');
    held.release();
    await outcome;
    await s.close();
  }
});
test('revocation committed while machine authentication waits refuses before recording', async () => {
  const s = await fixture(),
    held = await s.f.pool.connect();
  let outcome: Promise<Response> | undefined;
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      });
    await held.query('BEGIN');
    await held.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1', [
      s.v.installation,
    ]);
    outcome = s.report(proof);
    assert.match(await blocked(s.f.pool), /FOR UPDATE OF i/);
    await held.query('COMMIT');
    await refusal(await outcome, 403, 'permission_denied');
    assert.equal(
      (
        await s.a.request('history', {
          scope,
          afterSequence: '0',
          nonce: 'test',
        })
      ).events.length,
      2,
    );
  } finally {
    await held.query('ROLLBACK');
    held.release();
    await outcome;
    await s.close();
  }
});
test('durable consumed receipt reconciles by status after its real PostgreSQL commit fails', async () => {
  const s = await fixture();
  try {
    const r = await (await s.request('reserve', s.v.input)).json(),
      input = {
        version: 1,
        operationId: randomUUID(),
        allocationId: r.payload.allocation.allocationId,
        binding: s.v.input.binding,
        oldMachineOffline: true,
        oldMachineAbsent: false,
        noParallelRecovery: true,
        confirmedAt: new Date().toISOString(),
      };
    await s.f.pool.query(
      'CREATE TABLE fiscal_commit_parent(id integer PRIMARY KEY); CREATE TABLE fiscal_commit_child(id integer REFERENCES fiscal_commit_parent DEFERRABLE INITIALLY DEFERRED)',
    );
    await s.f.pool
      .query(`CREATE FUNCTION fiscal_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO fiscal_commit_child VALUES(1); RETURN NEW; END $$;
      CREATE TRIGGER fiscal_fail_commit AFTER INSERT ON fiscal_registry_events FOR EACH ROW WHEN (NEW.action='consume') EXECUTE FUNCTION fiscal_fail_commit()`);
    await refusal(await s.request('consume', input), 503, 'temporarily_unavailable');
    await s.f.pool.query('DROP TRIGGER fiscal_fail_commit ON fiscal_registry_events');
    const events = (await s.a.request('history', { scope, afterSequence: '0', nonce: 'test' }))
      .events;
    assert.equal(events.length, 2);
    await s.a.restart();
    const restarted = await s.server();
    const response = await s.request(
      'status',
      { version: 1, venueId: s.v.id, operationId: input.operationId },
      { port: restarted },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      version: 1,
      state: 'recorded',
      receipt: events[1].receipt,
    });
    assert.equal(events[1].receipt.payload.state, 'consumed');
    await retain('task4-http-consume-failed-commit-proof', {
      events,
      result: events[1].receipt,
    });
  } finally {
    await s.close();
  }
});
test('failed PostgreSQL report commit returns the original external result after restart', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope: s.v.input.scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      });
    await s.f.pool.query(
      'CREATE TABLE fiscal_commit_parent(id integer PRIMARY KEY); CREATE TABLE fiscal_commit_child(id integer REFERENCES fiscal_commit_parent DEFERRABLE INITIALLY DEFERRED)',
    );
    await s.f.pool
      .query(`CREATE FUNCTION fiscal_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO fiscal_commit_child VALUES(1); RETURN NEW; END $$;
      CREATE TRIGGER fiscal_fail_commit AFTER INSERT ON fiscal_registry_events FOR EACH ROW WHEN (NEW.action='report') EXECUTE FUNCTION fiscal_fail_commit()`);
    await refusal(await s.report(proof), 503, 'temporarily_unavailable');
    const events = (await s.a.request('history', { scope, afterSequence: '0', nonce: 'test' }))
      .events;
    assert.equal(events.length, 3);
    await s.f.pool.query('DROP TRIGGER fiscal_fail_commit ON fiscal_registry_events');
    await s.a.restart();
    const restarted = await s.server();
    const result = await s.report(proof, { port: restarted });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      version: 1,
      state: 'matched',
      receiptId: r.payload.receiptId,
    });
    assert.equal(
      (
        await s.f.pool.query(
          "SELECT count(*)::int AS n FROM fiscal_registry_events WHERE action='report'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await s.close();
  }
});
test('two listeners share the authenticated account read budget', async () => {
  const s = await fixture();
  try {
    const port = await s.server(),
      input = { version: 1, venueId: s.v.id, operationId: randomUUID() };
    for (let n = 0; n < 30; n++)
      assert.equal((await s.request('status', input, { port: n % 2 ? port : s.port })).status, 200);
    await refusal(await s.request('status', input, { port }), 429, 'rate_limited');
  } finally {
    await s.close();
  }
});
test('machine report rejects every present browser Origin header', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      });
    for (const value of [origin, ''])
      await refusal(await s.report(proof, { headers: { origin: value } }), 403, 'forbidden');
    assert.equal(
      (await s.a.request('history', { scope, afterSequence: '0', nonce: 'test' })).events.length,
      2,
    );
  } finally {
    await s.close();
  }
});
test('machine reports accept incident evidence within the HTTP request budget', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { evidence: 'x'.repeat(2100) },
      });
    assert.ok(Buffer.byteLength(JSON.stringify(proof)) < 16384);
    const response = await s.report(proof);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      version: 1,
      state: 'matched',
      receiptId: r.payload.receiptId,
    });
  } finally {
    await s.close();
  }
});
test('a machine signature cannot authorize a forged registration lease signature', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      lease = { ...s.lease, signature: Buffer.alloc(64).toString('base64url') };
    const proof = s.proof(
      {
        venueId: s.v.id,
        scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      },
      { lease: JSON.stringify(lease) },
    );
    await refusal(await s.report(proof), 401, 'invalid_proof');
    assert.equal(
      (await s.a.request('history', { scope, afterSequence: '0', nonce: 'test' })).events.length,
      2,
    );
  } finally {
    await s.close();
  }
});
test('two listeners share the verified installation report budget', async () => {
  const s = await fixture();
  try {
    const r = await consumed(s),
      proof = s.proof({
        venueId: s.v.id,
        scope,
        receipt: r,
        paperHistory: null,
        activationEvidence: { result: 'committed' },
      }),
      port = await s.server();
    for (let n = 0; n < 30; n++)
      assert.equal((await s.report(proof, { port: n % 2 ? port : s.port })).status, 200);
    await refusal(await s.report(proof, { port }), 429, 'rate_limited');
  } finally {
    await s.close();
  }
});
for (const kind of ['account', 'machine'] as const)
  test(`unverified ${kind} traffic has a shared sixty-request IP budget`, async () => {
    const s = await fixture();
    try {
      const port = await s.server();
      for (let n = 0; n < 60; n++) {
        const response =
          kind === 'account'
            ? await s.request('reserve', s.v.input, {
                port: n % 2 ? port : s.port,
                headers: { cookie: '' },
              })
            : await s.report({}, { port: n % 2 ? port : s.port });
        assert.equal(response.status, 401);
      }
      const response =
        kind === 'account'
          ? await s.request('reserve', s.v.input, { port, headers: { cookie: '' } })
          : await s.report({}, { port });
      await refusal(response, 429, 'rate_limited');
    } finally {
      await s.close();
    }
  });
