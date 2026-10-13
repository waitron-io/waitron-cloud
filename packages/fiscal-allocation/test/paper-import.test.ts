import assert from 'node:assert/strict';
import { randomUUID, createPrivateKey, sign } from 'node:crypto';
import { test } from 'node:test';
import { storeFixture } from './store-fixture.ts';
import { key, scope, bases, binding } from './fixtures.ts';
import { paperSigningBytes } from '../src/evidence.ts';
import { requestDigest, requireCurrentHistory } from '../src/continuity.ts';
import type {
  PaperHistoryInput,
  PaperBlock,
  PaperConsumption,
  PaperTransfer,
} from '../src/types.ts';

const refused = (code: string) => (e: { code?: string }) => {
  assert.equal(e.code, code);
  return true;
};
function signed<T>(payload: T, k: ReturnType<typeof key>) {
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
async function paperFixture() {
  const s = await storeFixture(),
    v = await s.venue(),
    k = key();
  const trust = {
    custodianId: 'custodian-1',
    custodyVersion: 'custody-1',
    keys: new Map([[k.keyId, k.publicKey]]),
  };
  const options = { ...s.options, paperTrust: trust };
  const { FiscalAllocationStore } = await import('../src/store.ts');
  const store = new FiscalAllocationStore(s.f.pool, options);
  const block: PaperBlock = {
    version: 1,
    custodianId: 'custodian-1',
    generationId: 'generation-1',
    blockId: 'block-1',
    packVersion: 1,
    recipientVenueId: v.id,
    allocations: ['S000001', 'P000001'].map((identity, i) => ({
      version: 1,
      allocationId: randomUUID(),
      ...scope,
      installationIdentity: identity,
      series: bases.map((b) => ({ ...b, code: b.code + '-' + identity })),
      source: i === 0 ? 'initial-paper' : 'paper',
      issuedAt: '2026-10-13T10:00:00.000Z',
    })),
  };
  const input: PaperHistoryInput = {
    version: 1,
    operationId: randomUUID(),
    venueId: v.id,
    scope,
    custodyVersion: 'custody-1',
    registerRevision: '1',
    previousDigest: '0'.repeat(64),
    block: signed(block, k),
    consumptions: [],
    transfers: [],
  };
  function consumption(
    allocationId = block.allocations[1]!.allocationId,
    change: Partial<PaperConsumption> = {},
  ) {
    return signed(
      {
        version: 1 as const,
        custodianId: 'custodian-1',
        blockDigest: requestDigest(block),
        allocationId,
        ...binding,
        consumedAt: '2026-10-13T11:00:00.000Z',
        ...change,
      },
      k,
    );
  }
  function transfer(
    toVenueId: string,
    previousDigest: string,
    revision = '2',
    change: Partial<PaperTransfer> = {},
  ) {
    return {
      ...signed(
        {
          version: 1 as const,
          custodianId: 'custodian-1',
          blockDigest: requestDigest(block),
          allocationIds: block.allocations.map((a) => a.allocationId),
          fromVenueId: v.id,
          toVenueId,
          registerRevision: revision,
          previousDigest,
          transferredAt: '2026-10-13T11:00:00.000Z',
          ...change,
        },
        k,
      ),
      keyId: k.keyId,
    };
  }
  return { ...s, v, k, trust, options, store, block, input, consumption, transfer };
}
test('signed S/P reservations and offline consumption add immutable facts without minting C', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input);
    assert.deepEqual(first, {
      version: 1,
      importId: s.input.operationId,
      acceptedRevision: '1',
      historyDigest: requestDigest(s.input),
    });
    const next = {
      ...s.input,
      operationId: randomUUID(),
      registerRevision: '2',
      previousDigest: first.historyDigest,
      consumptions: [s.consumption()],
    };
    const result = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, next);
    assert.equal(result.acceptedRevision, '2');
    const facts = (
      await s.f.pool.query(
        'SELECT fact,register_revision::text FROM fiscal_registry_paper_events ORDER BY register_revision',
      )
    ).rows;
    assert.deepEqual(
      facts.map((r) => r.fact),
      [s.input, next],
    );
    assert.deepEqual(
      facts.map((r) => r.register_revision),
      ['1', '2'],
    );
    assert.equal(
      (
        await requireCurrentHistory(
          {
            ...s.options.continuity!,
            verification: { ...s.options.continuity!.verification, paperTrust: s.trust },
          },
          scope,
          null,
        )
      ).witness.cHighWater,
      0,
    );
  } finally {
    await s.close();
  }
});
test('exact old retry acknowledges its revision without omitting later consumed facts', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input);
    const next = {
      ...s.input,
      operationId: randomUUID(),
      registerRevision: '2',
      previousDigest: first.historyDigest,
      consumptions: [s.consumption()],
    };
    await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, next);
    assert.deepEqual(
      await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
      first,
    );
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events')).rows[0]
        .n,
      2,
    );
    assert.deepEqual(
      (
        await s.f.pool.query(
          'SELECT fact FROM fiscal_registry_paper_events WHERE register_revision=2',
        )
      ).rows[0].fact.consumptions,
      next.consumptions,
    );
  } finally {
    await s.close();
  }
});
for (const kind of [
  'stale-revision',
  'missing-link',
  'changed-binding',
  'changed-block',
  'unsigned-block',
  'unsigned-consumption',
] as const)
  test('paper import refuses ' + kind + ' and retains original history', async () => {
    const s = await paperFixture();
    try {
      const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input);
      const consumed = {
        ...s.input,
        operationId: randomUUID(),
        registerRevision: '2',
        previousDigest: first.historyDigest,
        consumptions: [s.consumption()],
      };
      const second = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, consumed);
      let bad: PaperHistoryInput = {
        ...s.input,
        operationId: randomUUID(),
        registerRevision: '3',
        previousDigest: second.historyDigest,
        consumptions: [s.consumption()],
      };
      if (kind === 'stale-revision') bad = { ...bad, registerRevision: '1' };
      if (kind === 'missing-link') bad = { ...bad, previousDigest: 'f'.repeat(64) };
      if (kind === 'changed-binding')
        bad = { ...bad, consumptions: [s.consumption(undefined, { targetNodeId: 'different' })] };
      if (kind === 'changed-block')
        bad = {
          ...bad,
          block: signed(
            {
              ...s.block,
              allocations: s.block.allocations.map((a) => ({ ...a, allocationId: randomUUID() })),
            },
            s.k,
          ),
        };
      if (kind === 'unsigned-block')
        bad = {
          ...bad,
          block: { ...bad.block, signature: Buffer.alloc(64).toString('base64url') },
        };
      if (kind === 'unsigned-consumption')
        bad = {
          ...bad,
          consumptions: [{ ...s.consumption(), signature: Buffer.alloc(64).toString('base64url') }],
        };
      await assert.rejects(
        s.store.importPaper(s.v.session.token, s.v.session.csrfToken, bad),
        refused(kind.startsWith('unsigned') ? 'reservation_untrusted' : 'binding_conflict'),
      );
      assert.equal(
        (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events'))
          .rows[0].n,
        2,
      );
    } finally {
      await s.close();
    }
  });
test('later omission cannot free consumed paper names or grant a transfer of them', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, {
      ...s.input,
      consumptions: [s.consumption()],
    });
    const second = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, {
      ...s.input,
      operationId: randomUUID(),
      registerRevision: '2',
      previousDigest: first.historyDigest,
    });
    const b = await s.venue();
    await assert.rejects(
      s.store.importPaper(b.session.token, b.session.csrfToken, {
        ...s.input,
        venueId: b.id,
        operationId: randomUUID(),
        registerRevision: '3',
        previousDigest: second.historyDigest,
        transfers: [s.transfer(b.id, second.historyDigest, '3')],
      }),
      refused('binding_conflict'),
    );
    const facts = (
      await s.f.pool.query(
        'SELECT fact FROM fiscal_registry_paper_events ORDER BY register_revision',
      )
    ).rows;
    assert.equal(
      facts[0].fact.consumptions[0].payload.allocationId,
      s.block.allocations[1]!.allocationId,
    );
  } finally {
    await s.close();
  }
});
test('current signed transfer preserves the original block and complete ownership chain', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
      b = await s.venue();
    const transfer = s.transfer(b.id, first.historyDigest);
    const input = {
      ...s.input,
      venueId: b.id,
      operationId: randomUUID(),
      registerRevision: '2',
      previousDigest: first.historyDigest,
      transfers: [transfer],
    };
    await s.store.importPaper(b.session.token, b.session.csrfToken, input);
    const facts = (
      await s.f.pool.query(
        'SELECT fact FROM fiscal_registry_paper_events ORDER BY register_revision',
      )
    ).rows;
    assert.deepEqual(
      facts.map((r) => r.fact.block),
      [s.input.block, s.input.block],
    );
    assert.deepEqual(facts[1].fact.transfers, [transfer]);
    await assert.rejects(
      s.store.importPaper(s.v.session.token, s.v.session.csrfToken, {
        ...input,
        venueId: s.v.id,
        operationId: randomUUID(),
        registerRevision: '3',
        previousDigest: requestDigest(input),
        transfers: [],
      }),
      refused('binding_conflict'),
    );
  } finally {
    await s.close();
  }
});
test('a partial transfer keeps the entire signed block and only its named allocations change owner', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
      b = await s.venue();
    const transfer = s.transfer(b.id, first.historyDigest, '2', {
      allocationIds: [s.block.allocations[1]!.allocationId],
    });
    const input = {
      ...s.input,
      venueId: b.id,
      operationId: randomUUID(),
      registerRevision: '2',
      previousDigest: first.historyDigest,
      transfers: [transfer],
    };
    const second = await s.store.importPaper(b.session.token, b.session.csrfToken, input);
    const consumed = {
      ...s.input,
      venueId: b.id,
      operationId: randomUUID(),
      registerRevision: '3',
      previousDigest: second.historyDigest,
      consumptions: [s.consumption()],
    };
    const third = await s.store.importPaper(b.session.token, b.session.csrfToken, consumed);
    await assert.rejects(
      s.store.importPaper(b.session.token, b.session.csrfToken, {
        ...consumed,
        operationId: randomUUID(),
        registerRevision: '4',
        previousDigest: third.historyDigest,
        consumptions: [s.consumption(s.block.allocations[0]!.allocationId)],
      }),
      refused('binding_conflict'),
    );
    assert.deepEqual(
      (
        await s.f.pool.query(
          'SELECT fact FROM fiscal_registry_paper_events WHERE register_revision=3',
        )
      ).rows[0].fact.block,
      s.input.block,
    );
  } finally {
    await s.close();
  }
});
for (const kind of ['forged', 'wrong-owner', 'skipped-chain'])
  test('paper transfer refuses ' + kind, async () => {
    const s = await paperFixture();
    try {
      const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
        b = await s.venue();
      let transfer = s.transfer(b.id, first.historyDigest);
      if (kind === 'forged')
        transfer = { ...transfer, signature: Buffer.alloc(64).toString('base64url') };
      if (kind === 'wrong-owner')
        transfer = s.transfer(b.id, first.historyDigest, '2', { fromVenueId: randomUUID() });
      if (kind === 'skipped-chain') transfer = s.transfer(b.id, 'f'.repeat(64));
      await assert.rejects(
        s.store.importPaper(b.session.token, b.session.csrfToken, {
          ...s.input,
          venueId: b.id,
          operationId: randomUUID(),
          registerRevision: '2',
          previousDigest: first.historyDigest,
          transfers: [transfer],
        }),
        refused(kind === 'forged' ? 'reservation_untrusted' : 'binding_conflict'),
      );
    } finally {
      await s.close();
    }
  });
test('paper imported after authority outage is recorded exactly once', async () => {
  const s = await paperFixture();
  try {
    const input = { ...s.input, consumptions: [s.consumption()] };
    await s.a.request('fault', { fault: 'history-outage' });
    await assert.rejects(
      s.store.importPaper(s.v.session.token, s.v.session.csrfToken, input),
      refused('continuity_unavailable'),
    );
    await s.a.request('fault', { fault: 'none' });
    const result = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, input);
    assert.deepEqual(
      await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, input),
      result,
    );
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events')).rows[0]
        .n,
      1,
    );
  } finally {
    await s.close();
  }
});
test('signed blocks accept arbitrary ordering but never fill an older reserved gap', async () => {
  const s = await paperFixture();
  try {
    const allocations = [3, 1, 2].map((n) => ({
      ...s.block.allocations[1]!,
      allocationId: randomUUID(),
      installationIdentity: 'P00000' + n,
      series: bases.map((b) => ({ ...b, code: b.code + '-P00000' + n })),
    }));
    const first = { ...s.input, block: signed({ ...s.block, allocations }, s.k) };
    const result = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, first);
    const old = {
      ...allocations[0]!,
      allocationId: randomUUID(),
      installationIdentity: 'P000002',
      series: bases.map((b) => ({ ...b, code: b.code + '-P000002' })),
    };
    await assert.rejects(
      s.store.importPaper(s.v.session.token, s.v.session.csrfToken, {
        ...s.input,
        operationId: randomUUID(),
        registerRevision: '2',
        previousDigest: result.historyDigest,
        block: signed({ ...s.block, blockId: 'block-2', allocations: [old] }, s.k),
      }),
      refused('binding_conflict'),
    );
  } finally {
    await s.close();
  }
});
test('new custody key versions cannot re-sign a current register without a qualified transfer', async () => {
  const s = await paperFixture();
  try {
    const first = await s.store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
      nextKey = key();
    const { FiscalAllocationStore } = await import('../src/store.ts');
    const nextTrust = {
      custodianId: 'custodian-1',
      custodyVersion: 'custody-2',
      keys: new Map([[nextKey.keyId, nextKey.publicKey]]),
    };
    const store = new FiscalAllocationStore(s.f.pool, {
      ...s.options,
      paperTrust: nextTrust,
      paperHistoryTrust: new Map([['custody-1', s.trust]]),
      custody: {
        async check(...args) {
          return { ...(await s.options.custody!.check(...args)), custodyVersion: 'custody-2' };
        },
      },
    });
    const input = {
      ...s.input,
      operationId: randomUUID(),
      custodyVersion: 'custody-2',
      registerRevision: '2',
      previousDigest: first.historyDigest,
      block: signed(s.block, nextKey),
    };
    await assert.rejects(
      store.importPaper(s.v.session.token, s.v.session.csrfToken, input),
      refused('binding_conflict'),
    );
    assert.deepEqual(
      await store.importPaper(s.v.session.token, s.v.session.csrfToken, s.input),
      first,
    );
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events')).rows[0]
        .n,
      1,
    );
  } finally {
    await s.close();
  }
});

test('unsigned first consumption cannot enter the independent journal', async () => {
  const s = await paperFixture();
  try {
    const input = {
      ...s.input,
      consumptions: [{ ...s.consumption(), signature: Buffer.alloc(64).toString('base64url') }],
    };
    await assert.rejects(
      s.store.importPaper(s.v.session.token, s.v.session.csrfToken, input),
      refused('reservation_untrusted'),
    );
    assert.equal((await s.a.adapter().history(scope, '0', randomUUID())).events.length, 0);
    assert.equal(
      (await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_paper_events')).rows[0]
        .n,
      0,
    );
  } finally {
    await s.close();
  }
});
