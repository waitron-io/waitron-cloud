import { randomUUID } from 'node:crypto';
import {
  requireCurrentHistory,
  fenceWriter,
  appendEvent,
  requestDigest,
} from '../src/continuity.ts';
import { signReceipt } from '../src/evidence.ts';
import { payload, scope, key } from './fixtures.ts';
import type { ContinuityAuthority, RegistryEvent } from '../src/policy.ts';
let raw = '';
for await (const b of process.stdin) raw += b;
const config = JSON.parse(raw);
async function request(action: string, body: unknown) {
  const r = await fetch(config.url + '/' + action, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.code), { code: d.code });
  return d;
}
const authority: ContinuityAuthority = {
  verification: {
    authorityId: 'fixture-authority',
    keys: new Map([[config.keyId, config.publicKey]]),
    receipts: {
      issuer: 'fixture-registry',
      keys: new Map([[config.keyId, config.publicKey]]),
    },
    policy: config.policy,
  },
  current: (scope, nonce) => request('current', { scope, nonce }),
  history: (scope, afterSequence, nonce) => request('history', { scope, afterSequence, nonce }),
  fence: (scope, nonce) => request('fence', { scope, nonce }),
  claim: (input) => request('claim', input),
};
try {
  if (config.action === 'store-reserve') {
    const { Pool } = await import('pg');
    const { FiscalAllocationStore } = await import('../src/store.ts');
    const { testOptions } = await import('./store-fixture.ts');
    const pool = new Pool(config.input.connection);
    try {
      const store = new FiscalAllocationStore(pool, testOptions(authority));
      console.log(
        JSON.stringify({
          pid: process.pid,
          receipt: await store.reserve(config.input.token, config.input.csrf, config.input.input),
        }),
      );
    } finally {
      await pool.end();
    }
  } else if (config.action === 'fence')
    console.log(JSON.stringify({ grant: await fenceWriter(authority, scope) }));
  else {
    const { input, accountId, grant } = config.input;
    for (let retry = 0; retry < 4; retry++) {
      const history =
        config.action === 'raw-reserve'
          ? await authority.history(scope, '0', randomUUID())
          : await requireCurrentHistory(authority, scope, grant);
      const p = payload(),
        now = new Date().toISOString(),
        sequence = String(BigInt(history.witness.sequence) + 1n);
      const identity =
        config.input.identity ?? 'C' + String(history.witness.cHighWater + 1).padStart(6, '0');
      const allocation = {
        ...p.allocation,
        allocationId: randomUUID(),
        installationIdentity: identity,
        series: input.bases.map(
          (b: { code: string; purpose: 'standard' | 'full' | 'rectificative' }) => ({
            code: b.code + '-' + identity,
            purpose: b.purpose,
          }),
        ),
        reservationEvidence: {
          kind: 'cloud',
          authorityId: 'fixture-authority',
          reservationId: input.operationId,
          reservationSequence: sequence,
        },
        issuedAt: now,
      };
      const event: RegistryEvent = {
        eventId: randomUUID(),
        scope,
        sequence,
        operationId: input.operationId,
        action: 'reserve',
        requestDigest: requestDigest(input),
        request: input,
        allocationId: allocation.allocationId,
        allocation,
        binding: input.binding,
        recordedAt: now,
        previousDigest: history.witness.historyDigest,
        receipt: null,
      };
      // The fixture authority replaces this proposal with its retained signature at append.
      const signer = key();
      (event as { receipt: unknown }).receipt = signReceipt(
        {
          ...p,
          allocation,
          binding: input.binding,
          mode: input.mode,
          cloudAccountId: accountId,
          venueId: input.venueId,
          issuer: signer.issuer,
          receiptId: randomUUID(),
          continuity: {
            ...history.witness,
            sequence,
            cHighWater: Math.max(history.witness.cHighWater, Number(identity.slice(1))),
          },
          recordedAt: now,
        },
        signer,
      );
      if (config.action === 'malformed-reserve')
        (event as { allocation: unknown }).allocation = {
          ...allocation,
          series: allocation.series.filter((s: { purpose: string }) => s.purpose !== 'full'),
        };
      try {
        const result =
          config.action === 'raw-reserve'
            ? await authority.claim({
                scope,
                writerGrant: grant,
                expectedSequence: config.input.expectedSequence,
                operationId: input.operationId,
                requestDigest: event.requestDigest,
                event,
              })
            : await appendEvent(authority, scope, grant, event);
        console.log(JSON.stringify(result));
        break;
      } catch (e) {
        if ((e as { code?: string }).code === 'allocation_unavailable' && retry < 3) continue;
        throw e;
      }
    }
  }
} catch (e) {
  console.log(
    JSON.stringify({
      code: (e as { code?: string }).code ?? 'unexpected_error',
    }),
  );
}
