import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import test from 'node:test';
import { buildAltaRecord, validate } from '@waitron/verifactu';
import {
  validateReserve,
  validateIdentity,
  validateAllocation,
  validatePaperHistory,
  fiscalCandidate,
  requireBases,
  mapEnvironment,
} from '../src/validation.ts';
import {
  encodeReceipt,
  decodeReceipt,
  signReceipt,
  verifyPaperValue,
  paperSigningBytes,
} from '../src/evidence.ts';
import { requireCapabilities, authorizeCustody } from '../src/policy.ts';
import {
  reserve,
  key,
  payload,
  bases,
  binding,
  scope,
  date,
  venueId,
  operationId,
} from './fixtures.ts';
const error = (code: string) => (e: unknown) => {
  assert.equal((e as { code: string }).code, code);
  return true;
};

for (const identity of [
  'S000001',
  'S999999',
  'P000001',
  'P999999',
  'C000001',
  'C999999',
  'E00000000000000000000000000',
  'E7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
]) {
  test(`accepts bounded identity ${identity} through complete fiscal candidates`, () => {
    assert.equal(validateIdentity(identity), identity);
    for (const base of bases)
      assert.deepEqual(
        validate(buildAltaRecord(fiscalCandidate(scope, identity, base.code + '/9999999999'))),
        [],
      );
  });
}
for (const identity of [
  'S000000',
  'P000000',
  'C000000',
  'C1000000',
  'C-000001',
  'E8ZZZZZZZZZZZZZZZZZZZZZZZZZ',
  'E7IIIIIIIIIIIIIIIIIIIIIIIII',
]) {
  test(`refuses invalid short/emergency identity ${identity}`, () =>
    assert.throws(() => validateIdentity(identity), error('invalid_input')));
}
test('reserve makes an immutable independent complete snapshot', () => {
  const input = reserve(),
    value = validateReserve(input);
  input.binding.operatorId = 'changed';
  input.bases[1]!.purpose = 'standard' as never;
  assert.equal(value.binding.operatorId, 'operator-1');
  assert.equal(value.bases[1]!.purpose, 'full');
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.bases));
  assert.ok(Object.isFrozen(value.scope));
});
test('independent required bases refuse an omitted full series or relabelled full purpose', () => {
  const input = reserve();
  assert.doesNotThrow(() => requireBases(input.bases, bases));
  assert.throws(
    () =>
      requireBases(
        input.bases.filter((x) => x.purpose !== 'full'),
        bases,
      ),
    error('binding_conflict'),
  );
  assert.throws(
    () =>
      requireBases(
        input.bases.map((x) => ({ ...x, purpose: x.code === 'FF' ? 'standard' : x.purpose })),
        bases,
      ),
    error('binding_conflict'),
  );
  assert.doesNotThrow(() =>
    requireBases(
      [...bases, { code: 'FF2', purpose: 'full' }],
      [...bases, { code: 'FF2', purpose: 'full' }],
    ),
  );
});
test('exact reserve keys, UUIDs, series bounds and references refuse malformed input', () => {
  for (const change of [
    { extra: 'secret' },
    { operationId: 'bad' },
    { binding: { ...binding, key: 'secret' } },
    { scope: { ...scope, softwareId: 'wT' } },
    { scope: { ...scope, taxpayerNif: 'lowercase' } },
    { bases: [] },
    { bases: [...bases, bases[0]] },
    { bases: [{ code: 'A'.repeat(22), purpose: 'standard' }] },
    { bases: Array.from({ length: 21 }, (_, i) => ({ code: 'B' + i, purpose: 'standard' })) },
    { binding: { ...binding, incidentEvidence: 'x'.repeat(257) } },
  ])
    assert.throws(() => validateReserve({ ...reserve(), ...change }), error('invalid_input'));
});
test('registration test maps to preproduction and all inconsistent/unknown environments refuse', () => {
  assert.equal(mapEnvironment('test', 'preproduction'), 'preproduction');
  assert.equal(mapEnvironment('production', 'production'), 'production');
  for (const pair of [
    ['test', 'production'],
    ['production', 'preproduction'],
    ['preproduction', 'preproduction'],
    ['dev', 'preproduction'],
  ])
    assert.throws(() => mapEnvironment(pair[0]!, pair[1]!), error('binding_conflict'));
  assert.throws(
    () => validateReserve({ ...reserve(), scope: { ...scope, environment: 'test' } }),
    error('invalid_input'),
  );
});
test('actual fiscal validator accepts the 21/27/60 boundary and refuses the 61-character control', () => {
  const identity = 'E7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
    number = 'ABCDEFGHIJKLMNOPQRSTU-E7ZZZZZZZZZZZZZZZZZZZZZZZZZ/9999999999';
  assert.equal(number.length, 60);
  assert.deepEqual(validate(buildAltaRecord(fiscalCandidate(scope, identity, number))), []);
  const failures = validate(buildAltaRecord(fiscalCandidate(scope, identity, 'X' + number)));
  assert.ok(failures.some((x) => x.severity === 'error' && x.field === 'NumSerieFactura'));
});
test('allocation validates each purpose and exact suffix with the actual fiscal validator', () => {
  assert.equal(validateAllocation(payload().allocation).series[1]!.purpose, 'full');
  for (const change of [
    { source: 'paper' },
    { series: [{ code: 'FF-C000042', purpose: 'other' }] },
    { series: [{ code: 'A-C000043', purpose: 'standard' }] },
    { taxpayerNif: '89890001A' },
  ])
    assert.throws(
      () => validateAllocation({ ...payload().allocation, ...change }),
      error('invalid_input'),
    );
});
test('all missing or null capabilities deny issuance; invalid timing policy refuses', () => {
  for (const capability of ['entitlement', 'custody', 'continuity', 'signer', 'trust', 'policy']) {
    const full = {
      entitlement: {},
      custody: {},
      continuity: {},
      signer: key(),
      trust: {},
      policy: { continuityTimeoutMs: 100, witnessMaxAgeMs: 1000, writerLifetimeMs: 5000 },
    };
    for (const value of [null, undefined])
      assert.throws(
        () => requireCapabilities({ ...full, [capability]: value } as never),
        error(
          capability === 'custody'
            ? 'custody_unavailable'
            : capability === 'entitlement'
              ? 'entitlement_unavailable'
              : capability === 'signer' || capability === 'trust'
                ? 'reservation_untrusted'
                : 'continuity_unavailable',
        ),
      );
  }
  for (const policy of [
    { continuityTimeoutMs: 5001, witnessMaxAgeMs: 1, writerLifetimeMs: 1 },
    { continuityTimeoutMs: 1, witnessMaxAgeMs: 0, writerLifetimeMs: 1 },
    { continuityTimeoutMs: 1, witnessMaxAgeMs: 1, writerLifetimeMs: Infinity },
  ])
    assert.throws(
      () =>
        requireCapabilities({
          entitlement: {},
          custody: {},
          continuity: {},
          signer: key(),
          trust: {},
          policy,
        } as never),
      error('continuity_unavailable'),
    );
});
test('self-submitted taxpayer or unverified operator cannot establish custody', () => {
  assert.throws(
    () =>
      authorizeCustody(
        {
          custodianId: '',
          custodyVersion: '1',
          operatorBindingVerified: true,
          requiredBases: bases,
        },
        reserve(),
      ),
    error('custody_unavailable'),
  );
  assert.throws(
    () =>
      authorizeCustody(
        {
          custodianId: 'custodian',
          custodyVersion: '1',
          operatorBindingVerified: false,
          requiredBases: bases,
        },
        reserve(),
      ),
    error('custody_unavailable'),
  );
  assert.doesNotThrow(() =>
    authorizeCustody(
      {
        custodianId: 'custodian',
        custodyVersion: '1',
        operatorBindingVerified: true,
        requiredBases: bases,
      },
      reserve(),
    ),
  );
});
test('canonical manual packet round trip retains every signed binding field without secrets', () => {
  const signer = key(),
    receipt = signReceipt(payload(), signer),
    packet = encodeReceipt(receipt),
    trust = { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) };
  assert.ok(packet.startsWith('WAITRON-FISCAL-ALLOCATION-1:'));
  assert.deepEqual(decodeReceipt(packet, trust), receipt);
  assert.equal(encodeReceipt(decodeReceipt(packet, trust)), packet);
  assert.ok(!packet.includes(signer.privateKey));
  assert.ok(Object.isFrozen(decodeReceipt(packet, trust).payload.binding));
});
test('mutating any snapshot or envelope field refuses the original signature', () => {
  const signer = key(),
    receipt = signReceipt(payload(), signer),
    trust = { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) };
  const mutations = [
    { ...receipt, keyId: 'f'.repeat(64) },
    { ...receipt, signature: Buffer.alloc(64, 2).toString('base64url') },
    { ...receipt, payload: { ...receipt.payload, binding: { ...binding, sourceId: 'another' } } },
    { ...receipt, payload: { ...receipt.payload, entitlementVersion: 'another' } },
    {
      ...receipt,
      payload: {
        ...receipt.payload,
        allocation: {
          ...receipt.payload.allocation,
          series: receipt.payload.allocation.series.map((x) => ({ ...x, purpose: 'standard' })),
        },
      },
    },
  ];
  for (const changed of mutations)
    assert.throws(
      () => decodeReceipt(encodeReceipt(changed as never), trust),
      error('reservation_untrusted'),
    );
});
test('noncanonical packets, extra secret fields and oversized receipts refuse', () => {
  const signer = key(),
    receipt = signReceipt(payload(), signer),
    trust = { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) },
    packet = encodeReceipt(receipt);
  for (const text of [
    packet + '=',
    packet + '\n',
    packet.replace('WAITRON', 'waitron'),
    'WAITRON-FISCAL-ALLOCATION-1:' +
      Buffer.from(JSON.stringify({ ...receipt, secret: 'key' })).toString('base64url'),
    'WAITRON-FISCAL-ALLOCATION-1:' + 'A'.repeat(12001),
  ])
    assert.throws(() => decodeReceipt(text, trust), error('reservation_untrusted'));
  assert.throws(
    () =>
      encodeReceipt({
        ...receipt,
        payload: {
          ...receipt.payload,
          binding: { ...binding, incidentEvidence: 'x'.repeat(12001) },
        },
      } as never),
    error('invalid_input'),
  );
});
test('receipt signing refuses inconsistent approval, witness, identity, source and recorded snapshots', () => {
  const signer = key(),
    p = payload();
  for (const changed of [
    { ...p, state: 'consumed' },
    {
      ...p,
      approval: {
        version: 1,
        ...binding,
        oldMachineOffline: true,
        oldMachineAbsent: false,
        noParallelRecovery: true,
        confirmedAt: date,
      },
    },
    { ...p, continuity: { ...p.continuity, scope: { ...scope, environment: 'production' } } },
    { ...p, continuity: { ...p.continuity, cHighWater: 41 } },
    {
      ...p,
      allocation: {
        ...p.allocation,
        reservationEvidence: { ...p.allocation.reservationEvidence, authorityId: 'other' },
      },
    },
    { ...p, recordedAt: 'yesterday' },
  ])
    assert.throws(() => signReceipt(changed as never, signer), error('invalid_input'));
});
test('consumed receipt binds the complete recovery or initial setup confirmation', () => {
  const signer = key(),
    p = payload();
  const approval = {
    version: 1 as const,
    ...binding,
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: date,
  };
  const result = signReceipt({ ...p, state: 'consumed', approval }, signer);
  assert.deepEqual(result.payload.approval, approval);
  for (const change of [
    { operatorId: 'other' },
    { oldMachineOffline: false },
    { oldMachineAbsent: true },
    { noParallelRecovery: false },
  ])
    assert.throws(
      () => signReceipt({ ...p, state: 'consumed', approval: { ...approval, ...change } }, signer),
      error('invalid_input'),
    );
  assert.doesNotThrow(() =>
    signReceipt(
      {
        ...p,
        mode: 'initial-setup',
        state: 'consumed',
        approval: { ...approval, oldMachineAbsent: true, oldMachineOffline: false },
      },
      signer,
    ),
  );
});
test('rotated signing key retains old trusted receipts and revoked/missing keys refuse', () => {
  const old = key(),
    next = key(),
    receipt = signReceipt(payload(), old),
    trust = {
      issuer: old.issuer,
      keys: new Map([
        [old.keyId, old.publicKey],
        [next.keyId, next.publicKey],
      ]),
    };
  assert.deepEqual(decodeReceipt(encodeReceipt(receipt), trust), receipt);
  assert.doesNotThrow(() => decodeReceipt(encodeReceipt(signReceipt(payload(), next)), trust));
  assert.throws(
    () => signReceipt(payload(), { ...old, active: false }),
    error('reservation_untrusted'),
  );
  for (const changed of [
    { ...old, privateKey: '' },
    { ...old, keyId: '0'.repeat(64) },
    { ...old, publicKey: next.publicKey },
  ])
    assert.throws(() => signReceipt(payload(), changed), error('reservation_untrusted'));
  trust.keys.delete(old.keyId);
  assert.throws(() => decodeReceipt(encodeReceipt(receipt), trust), error('reservation_untrusted'));
});
test('largest allowed twenty-base receipt round-trips without truncating its signed snapshot', () => {
  const signer = key(),
    p = payload();
  p.allocation.series = Array.from({ length: 20 }, (_, i) => ({
    code: 'B' + String(i).padStart(2, '0') + '-C000042',
    purpose: i % 3 === 0 ? 'full' : i % 3 === 1 ? 'rectificative' : 'standard',
  })) as never;
  const receipt = signReceipt(p, signer);
  assert.equal(
    decodeReceipt(encodeReceipt(receipt), {
      issuer: signer.issuer,
      keys: new Map([[signer.keyId, signer.publicKey]]),
    }).payload.allocation.series.length,
    20,
  );
});
function paperInput() {
  return {
    version: 1 as const,
    operationId,
    venueId,
    scope,
    custodyVersion: 'custody-1',
    registerRevision: '1',
    previousDigest: '0'.repeat(64),
    block: {
      payload: {
        version: 1 as const,
        custodianId: 'custodian',
        generationId: 'generation',
        blockId: 'block',
        packVersion: 1 as const,
        recipientVenueId: venueId,
        allocations: [
          {
            version: 1 as const,
            allocationId: payload().allocation.allocationId,
            ...scope,
            issuedAt: date,
            installationIdentity: 'P000042',
            source: 'paper' as const,
            series: bases.map((x) => ({ code: x.code + '-P000042', purpose: x.purpose })),
          },
        ],
      },
      signature: Buffer.alloc(64, 1).toString('base64url'),
    },
    consumptions: [],
    transfers: [],
  };
}
test('paper import bounds preserve whole blocks and refuse oversized arrays before any claim', () => {
  const input = paperInput();
  assert.equal(validatePaperHistory(input).block.payload.allocations.length, 1);
  for (const changed of [
    {
      ...input,
      block: {
        ...input.block,
        payload: {
          ...input.block.payload,
          allocations: Array.from({ length: 21 }, () => input.block.payload.allocations[0]),
        },
      },
    },
    { ...input, consumptions: Array(21).fill({}) },
    { ...input, transfers: Array(21).fill({}) },
    { ...input, secret: 'key' },
  ])
    assert.throws(() => validatePaperHistory(changed), error('invalid_input'));
});
test('paper signatures use separate versioned custody trust; revoked version/key and wrong fingerprint refuse', () => {
  const signer = key(),
    value = { ...paperInput().block };
  value.signature = sign(null, paperSigningBytes(value.payload), {
    key: Buffer.from(signer.privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  }).toString('base64url');
  const trust = {
    custodianId: 'custodian',
    custodyVersion: 'custody-1',
    keys: new Map([[signer.keyId, signer.publicKey]]),
  };
  assert.doesNotThrow(() => verifyPaperValue(value, signer.keyId, 'custody-1', trust));
  for (const changed of [
    { ...trust, custodyVersion: 'custody-2' },
    { ...trust, keys: new Map() },
    {
      ...trust,
      keys: new Map([[createHash('sha256').update('wrong').digest('hex'), signer.publicKey]]),
    },
  ])
    assert.throws(
      () => verifyPaperValue(value, signer.keyId, 'custody-1', changed),
      error('reservation_untrusted'),
    );
  assert.throws(
    () =>
      verifyPaperValue(
        { ...value, payload: { ...value.payload, recipientVenueId: operationId } },
        signer.keyId,
        'custody-1',
        trust,
      ),
    error('reservation_untrusted'),
  );
});

test('manual packet refuses altered object ordering and unsigned extra keys', () => {
  const signer = key(),
    receipt = signReceipt(payload(), signer),
    trust = { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) };
  const text =
    'WAITRON-FISCAL-ALLOCATION-1:' + Buffer.from(JSON.stringify(receipt)).toString('base64url');
  assert.throws(() => decodeReceipt(text, trust), error('reservation_untrusted'));
  assert.throws(
    () => signReceipt({ ...payload(), privateKey: 'never-export' } as never, signer),
    error('invalid_input'),
  );
  assert.throws(
    () => decodeReceipt(encodeReceipt(receipt), { ...trust, issuer: 'other-authority' }),
    error('reservation_untrusted'),
  );
});
test('paper block bytes preserve the inherited fixed-order signing protocol', () => {
  const input = paperInput();
  assert.equal(
    paperSigningBytes(input.block.payload).toString('utf8'),
    '["waitron.paper-block",1,"custodian","generation","block",1,"10000000-0000-4000-8000-000000000002",[[1,"10000000-0000-4000-8000-000000000003","89890001K","WT","preproduction","P000042",[["A-P000042","standard"],["FF-P000042","full"],["R-P000042","rectificative"]],"paper","2026-10-13T10:00:00.000Z"]]]',
  );
});
test('paper import refuses raw requests above the byte cap without truncating a valid block', () => {
  const input = paperInput();
  const maximum = {
    ...input,
    block: {
      ...input.block,
      payload: {
        ...input.block.payload,
        allocations: Array.from({ length: 20 }, (_, i) => ({
          ...input.block.payload.allocations[0],
          allocationId: '20000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
          installationIdentity: 'P' + String(i + 1).padStart(6, '0'),
          series: Array.from({ length: 20 }, (_, j) => ({
            code: 'BASE' + String(j).padStart(17, '0') + '-P' + String(i + 1).padStart(6, '0'),
            purpose: 'standard',
          })),
        })),
      },
    },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) > 16384);
  assert.throws(() => validatePaperHistory(maximum), error('invalid_input'));
  assert.equal(maximum.block.payload.allocations.length, 20);
  assert.equal(maximum.block.payload.allocations[0]!.series.length, 20);
});
test('largest consumed snapshot fits the manual packet or refuses before producing evidence', () => {
  const signer = key(),
    p = payload();
  const b = {
    eventId: 'e'.repeat(256),
    operatorId: 'o'.repeat(256),
    sourceId: 's'.repeat(256),
    targetNodeId: 't'.repeat(256),
    incidentEvidence: 'i'.repeat(256),
  };
  const value = {
    ...p,
    binding: b,
    state: 'consumed' as const,
    approval: {
      version: 1 as const,
      ...b,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: date,
    },
    allocation: {
      ...p.allocation,
      series: Array.from({ length: 20 }, (_, i) => ({
        code: 'BASE' + String(i).padStart(17, '0') + '-C000042',
        purpose: 'standard' as const,
      })),
    },
  };
  const packet = encodeReceipt(signReceipt(value, signer));
  assert.ok(Buffer.byteLength(packet) <= 12288);
  assert.equal(
    decodeReceipt(packet, {
      issuer: signer.issuer,
      keys: new Map([[signer.keyId, signer.publicKey]]),
    }).payload.allocation.series.length,
    20,
  );
});

test('oversized valid Unicode receipt is refused before a manual packet is returned', () => {
  const signer = key(),
    p = payload(),
    long = '漢'.repeat(256);
  const b = {
    eventId: long,
    operatorId: long,
    sourceId: long,
    targetNodeId: long,
    incidentEvidence: long,
  };
  const value = {
    ...p,
    issuer: long,
    binding: b,
    state: 'consumed' as const,
    approval: {
      version: 1 as const,
      ...b,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: date,
    },
    custodyVersion: long,
    entitlementVersion: long,
    allocation: {
      ...p.allocation,
      reservationEvidence: {
        kind: 'cloud' as const,
        authorityId: long,
        reservationId: operationId,
        reservationSequence: '42',
      },
      series: Array.from({ length: 20 }, (_, i) => ({
        code: 'BASE' + String(i).padStart(17, '0') + '-C000042',
        purpose: 'standard' as const,
      })),
    },
    continuity: { ...p.continuity, authorityId: long, requestNonce: long },
  };
  assert.throws(() => signReceipt(value, { ...signer, issuer: long }), error('invalid_input'));
});
