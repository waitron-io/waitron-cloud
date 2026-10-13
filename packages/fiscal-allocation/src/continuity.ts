import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import type { PoolClient } from 'pg';
import { FiscalAllocationError } from './types.ts';
import type { Scope, ContinuityWitness } from './types.ts';
import type {
  ContinuityAuthority,
  ContinuityHistory,
  WriterGrant,
  RegistryEvent,
  ContinuityResult,
} from './policy.ts';
import { canonical, fingerprint, decodeReceipt, encodeReceipt } from './evidence.ts';
import {
  validateScope,
  validateWitness,
  validateAllocation,
  validateBinding,
  validateReserve,
  validateConsume,
  validateAbandon,
  validatePaperHistory,
  record,
  uuid,
  decimal,
  digest,
  text,
  timestamp,
  encoded,
  snapshot,
} from './validation.ts';

import { verifyPaperInput, checkPaperProgress, paperResult } from './paper-import.ts';

const genesis = '0'.repeat(64);
const verified = new WeakSet<ContinuityHistory>();
const deadlines = new WeakMap<ContinuityHistory, { monotonic: number; maxAge: number }>();
function uncertain(): never {
  throw new FiscalAllocationError('history_uncertain');
}
function same(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}
export function requestDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function eventDigest(event: RegistryEvent): string {
  const { receipt: _, ...core } = event;
  return requestDigest(['waitron.fiscal-continuity-event', 1, core]);
}
function configuration(authority: ContinuityAuthority | null): ContinuityAuthority {
  const v = authority?.verification,
    p = v?.policy;
  if (
    !authority ||
    !v ||
    !v.authorityId ||
    !v.keys?.size ||
    !v.receipts ||
    !p ||
    Object.keys(p).length !== 3 ||
    ![p.continuityTimeoutMs, p.witnessMaxAgeMs, p.writerLifetimeMs].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 86400000,
    ) ||
    p.continuityTimeoutMs > 5000
  )
    throw new FiscalAllocationError('continuity_unavailable');
  return authority;
}
function signature(
  authority: ContinuityAuthority,
  keyId: string,
  value: unknown,
  signed: string,
): void {
  const key = authority.verification.keys.get(digest(keyId));
  if (!key || fingerprint(key) !== keyId) uncertain();
  const object = createPublicKey({
    key: Buffer.from(encoded(key), 'base64url'),
    type: 'spki',
    format: 'der',
  });
  if (
    object.asymmetricKeyType !== 'ed25519' ||
    !verify(
      null,
      Buffer.from(canonical(value)),
      object,
      Buffer.from(encoded(signed, 64), 'base64url'),
    )
  )
    uncertain();
}
function witness(
  authority: ContinuityAuthority,
  value: unknown,
  scope: Scope,
  nonce?: string,
): ContinuityWitness {
  const w = validateWitness(value),
    { signature: signed, ...core } = w;
  if (w.authorityId !== authority.verification.authorityId || !same(w.scope, scope)) uncertain();
  signature(authority, w.keyId, ['waitron.fiscal-continuity-witness', 1, core], signed);
  if (
    nonce !== undefined &&
    (w.requestNonce !== nonce ||
      Math.abs(Date.now() - Date.parse(w.observedAt)) >
        authority.verification.policy.witnessMaxAgeMs)
  )
    uncertain();
  return w;
}
async function bounded<T>(authority: ContinuityAuthority, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  try {
    const result = await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new FiscalAllocationError('continuity_unavailable')),
          authority.verification.policy.continuityTimeoutMs,
        );
      }),
    ]);
    if (performance.now() - started > authority.verification.policy.continuityTimeoutMs)
      throw new FiscalAllocationError('continuity_unavailable');
    return result;
  } catch {
    throw new FiscalAllocationError('continuity_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
function grantValue(
  authority: ContinuityAuthority,
  value: unknown,
  scope: Scope,
  current: ContinuityWitness,
): WriterGrant {
  const o = record(value, ['writerId', 'fence', 'expiresAt', 'witness', 'keyId', 'signature']);
  const g: WriterGrant = {
    writerId: text(o.writerId),
    fence: decimal(o.fence),
    expiresAt: timestamp(o.expiresAt),
    witness: witness(authority, o.witness, scope),
    keyId: digest(o.keyId),
    signature: encoded(o.signature, 64),
  };
  const { signature: signed, ...core } = g;
  signature(authority, g.keyId, ['waitron.fiscal-continuity-writer', 1, core], signed);
  // Authenticated authority time checks the lease; a restored local clock grants no extension.
  if (
    g.fence !== current.writerFence ||
    g.fence !== g.witness.writerFence ||
    Date.parse(g.expiresAt) <= Date.parse(current.observedAt) ||
    Date.parse(g.expiresAt) - Date.parse(g.witness.observedAt) >
      authority.verification.policy.writerLifetimeMs
  )
    uncertain();
  return snapshot(g);
}
function eventValue(authority: ContinuityAuthority, value: unknown, scope: Scope): RegistryEvent {
  const o = record(value, [
    'eventId',
    'scope',
    'sequence',
    'operationId',
    'action',
    'requestDigest',
    'request',
    'allocationId',
    'allocation',
    'binding',
    'recordedAt',
    'previousDigest',
    'receipt',
  ]);
  const action = o.action;
  // Replay accepts only actions with a complete, checked projection.
  if (action === 'paper-import') return paperValue(authority, o, scope);
  if (action === 'consume' || action === 'abandon') return terminalValue(authority, o, scope);
  if (action !== 'reserve') uncertain();
  const request = validateReserve(o.request),
    allocation = validateAllocation(o.allocation),
    binding = validateBinding(o.binding);
  const receipt = decodeReceipt(
    encodeReceipt(o.receipt as import('./types.ts').AllocationReceipt),
    authority.verification.receipts,
  );
  const e: RegistryEvent = {
    eventId: uuid(o.eventId),
    scope: validateScope(o.scope),
    sequence: decimal(o.sequence),
    operationId: uuid(o.operationId),
    action,
    requestDigest: digest(o.requestDigest),
    request,
    allocationId: uuid(o.allocationId),
    allocation,
    binding,
    recordedAt: timestamp(o.recordedAt),
    previousDigest: digest(o.previousDigest),
    receipt,
  };
  const p = receipt.payload;
  if (
    !same(e.scope, scope) ||
    !same(request.scope, scope) ||
    request.operationId !== e.operationId ||
    e.requestDigest !== requestDigest(request) ||
    e.allocationId !== allocation.allocationId ||
    !same(binding, request.binding) ||
    !same(p.allocation, allocation) ||
    !same(p.binding, binding) ||
    p.venueId !== request.venueId ||
    p.mode !== request.mode ||
    p.state !== 'reserved' ||
    p.recordedAt !== e.recordedAt ||
    allocation.issuedAt !== e.recordedAt ||
    allocation.taxpayerNif !== scope.taxpayerNif ||
    allocation.softwareId !== scope.softwareId ||
    allocation.environment !== scope.environment ||
    !same(
      allocation.series,
      request.bases.map((b) => ({
        code: b.code + '-' + allocation.installationIdentity,
        purpose: b.purpose,
      })),
    )
  )
    uncertain();
  const evidence = allocation.reservationEvidence as {
    authorityId: string;
    reservationId: string;
    reservationSequence: string;
  };
  if (
    evidence.authorityId !== authority.verification.authorityId ||
    evidence.reservationId !== e.operationId ||
    evidence.reservationSequence !== e.sequence
  )
    uncertain();
  const historical = witness(authority, p.continuity, scope);
  if (historical.sequence !== e.sequence || historical.historyDigest !== eventDigest(e))
    uncertain();
  return snapshot(e);
}
function paperValue(
  authority: ContinuityAuthority,
  o: Record<string, unknown>,
  scope: Scope,
): RegistryEvent {
  const request = validatePaperHistory(o.request);
  const trust =
    authority.verification.paperHistoryTrust?.get(request.custodyVersion) ??
    authority.verification.paperTrust;
  verifyPaperInput(request, trust);
  if (
    o.allocationId !== null ||
    o.allocation !== null ||
    o.binding !== null ||
    o.receipt !== null ||
    !same(request.scope, scope) ||
    !same(o.scope, scope) ||
    request.operationId !== o.operationId ||
    o.requestDigest !== requestDigest(request)
  )
    uncertain();
  return snapshot({
    eventId: uuid(o.eventId),
    scope: validateScope(o.scope),
    sequence: decimal(o.sequence),
    operationId: uuid(o.operationId),
    action: 'paper-import',
    requestDigest: digest(o.requestDigest),
    request,
    allocationId: null,
    allocation: null,
    binding: null,
    recordedAt: timestamp(o.recordedAt),
    previousDigest: digest(o.previousDigest),
    receipt: null,
  });
}
function terminalValue(
  authority: ContinuityAuthority,
  o: Record<string, unknown>,
  scope: Scope,
): RegistryEvent {
  const action = o.action as 'consume' | 'abandon';
  const request = action === 'consume' ? validateConsume(o.request) : validateAbandon(o.request);
  const allocation = validateAllocation(o.allocation),
    binding = validateBinding(o.binding);
  const receipt = decodeReceipt(
    encodeReceipt(o.receipt as import('./types.ts').AllocationReceipt),
    authority.verification.receipts,
  );
  const e: RegistryEvent = {
    eventId: uuid(o.eventId),
    scope: validateScope(o.scope),
    sequence: decimal(o.sequence),
    operationId: uuid(o.operationId),
    action,
    requestDigest: digest(o.requestDigest),
    request,
    allocationId: uuid(o.allocationId),
    allocation,
    binding,
    recordedAt: timestamp(o.recordedAt),
    previousDigest: digest(o.previousDigest),
    receipt,
  };
  const p = receipt.payload;
  if (
    !same(e.scope, scope) ||
    request.operationId !== e.operationId ||
    request.allocationId !== e.allocationId ||
    e.allocationId !== allocation.allocationId ||
    e.requestDigest !== requestDigest(request) ||
    !same(request.binding, binding) ||
    !same(p.binding, binding) ||
    !same(p.allocation, allocation) ||
    p.recordedAt !== e.recordedAt ||
    p.state !== (action === 'consume' ? 'consumed' : 'abandoned')
  )
    uncertain();
  if (action === 'consume') {
    const x = request as import('./types.ts').ConsumeInput;
    const approval = {
      version: 1,
      ...x.binding,
      oldMachineOffline: x.oldMachineOffline,
      oldMachineAbsent: x.oldMachineAbsent,
      noParallelRecovery: x.noParallelRecovery,
      confirmedAt: x.confirmedAt,
    };
    if (!same(p.approval, approval)) uncertain();
  }
  const historical = witness(authority, p.continuity, scope);
  if (historical.sequence !== e.sequence || historical.historyDigest !== eventDigest(e))
    uncertain();
  return snapshot(e);
}
export async function requireCurrentHistory(
  authority: ContinuityAuthority | null,
  scope: Scope,
  grant: WriterGrant | null,
): Promise<ContinuityHistory> {
  const a = configuration(authority);
  try {
    scope = validateScope(scope);
    const nonce = randomUUID(),
      current = witness(a, await bounded(a, () => a.current(scope, nonce)), scope, nonce);
    if (grant) grantValue(a, grant, scope, current);
    const historyNonce = randomUUID(),
      raw = record(await bounded(a, () => a.history(scope, '0', historyNonce)), [
        'events',
        'witness',
      ]);
    const latest = witness(a, raw.witness, scope, historyNonce);
    if (
      latest.writerFence !== current.writerFence ||
      BigInt(latest.sequence) < BigInt(current.sequence) ||
      latest.cHighWater < current.cHighWater ||
      Date.parse(latest.observedAt) < Date.parse(current.observedAt)
    )
      uncertain();
    if (grant) grantValue(a, grant, scope, latest);
    if (!Array.isArray(raw.events)) uncertain();
    const events = raw.events.map((e) => eventValue(a, e, scope));
    let previous = genesis,
      highWater = 0;
    const operations = new Set<string>(),
      allocations = new Set<string>(),
      names = new Set<string>(),
      ids = new Set<string>(),
      latestAllocation = new Map<string, RegistryEvent>();
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!,
        allocation = e.allocation!;
      if (
        e.sequence !== String(i + 1) ||
        e.previousDigest !== previous ||
        operations.has(e.operationId) ||
        ids.has(e.eventId)
      )
        uncertain();
      if (e.action === 'reserve') {
        if (
          allocations.has(allocation.allocationId) ||
          names.has(allocation.installationIdentity) ||
          allocation.installationIdentity !== 'C' + String(highWater + 1).padStart(6, '0')
        )
          uncertain();
        highWater++;
        allocations.add(allocation.allocationId);
        names.add(allocation.installationIdentity);
      } else if (e.action !== 'paper-import') {
        const prior = latestAllocation.get(allocation.allocationId);
        if (
          !prior ||
          prior.receipt!.payload.state !== 'reserved' ||
          !same(prior.allocation, allocation) ||
          !same(prior.binding, e.binding) ||
          prior.receipt!.payload.venueId !== e.receipt!.payload.venueId ||
          prior.receipt!.payload.mode !== e.receipt!.payload.mode
        )
          uncertain();
      }
      if (allocation) latestAllocation.set(allocation.allocationId, e);
      if (e.receipt && e.receipt.payload.continuity.cHighWater !== highWater) uncertain();
      operations.add(e.operationId);
      ids.add(e.eventId);
      previous = eventDigest(e);
    }
    if (
      latest.sequence !== String(events.length) ||
      latest.historyDigest !== previous ||
      latest.cHighWater !== highWater ||
      (current.sequence === latest.sequence &&
        (current.historyDigest !== latest.historyDigest ||
          current.cHighWater !== latest.cHighWater))
    )
      uncertain();
    checkPaperProgress(events);
    const currentPrefix = events.find((e) => e.sequence === current.sequence);
    if (
      current.historyDigest !== (currentPrefix ? eventDigest(currentPrefix) : genesis) ||
      current.cHighWater !==
        events.filter(
          (e) => e.action === 'reserve' && BigInt(e.sequence) <= BigInt(current.sequence),
        ).length
    )
      uncertain();
    const history = snapshot({ events, witness: latest });
    verified.add(history);
    const maxAge = a.verification.policy.witnessMaxAgeMs;
    deadlines.set(history, {
      maxAge,
      monotonic:
        performance.now() +
        Math.min(
          maxAge - Math.abs(Date.now() - Date.parse(latest.observedAt)),
          grant ? Date.parse(grant.expiresAt) - Date.parse(latest.observedAt) : maxAge,
        ),
    });
    return history;
  } catch (e) {
    if (e instanceof FiscalAllocationError && e.code === 'continuity_unavailable') throw e;
    uncertain();
  }
}
export async function fenceWriter(
  authority: ContinuityAuthority,
  scope: Scope,
): Promise<WriterGrant> {
  const a = configuration(authority);
  try {
    const nonce = randomUUID(),
      raw = await bounded(a, () => a.fence(scope, nonce));
    const w = witness(a, raw.witness, scope, nonce),
      g = grantValue(a, raw, scope, w);
    // A grant is usable only after the complete independent journal is reconciled.
    await requireCurrentHistory(a, scope, g);
    return g;
  } catch (e) {
    if (e instanceof FiscalAllocationError && e.code === 'continuity_unavailable') throw e;
    uncertain();
  }
}
export async function appendEvent(
  authority: ContinuityAuthority,
  scope: Scope,
  grant: WriterGrant,
  event: RegistryEvent,
): Promise<ContinuityResult> {
  const a = configuration(authority);
  record(event, [
    'eventId',
    'scope',
    'sequence',
    'operationId',
    'action',
    'requestDigest',
    'request',
    'allocationId',
    'allocation',
    'binding',
    'recordedAt',
    'previousDigest',
    'receipt',
  ]);
  uuid(event.eventId);
  uuid(event.operationId);
  decimal(event.sequence);
  digest(event.previousDigest);
  timestamp(event.recordedAt);
  const paper = event.action === 'paper-import';
  const reservation = event.action === 'reserve';
  const request = reservation
    ? validateReserve(event.request)
    : event.action === 'consume'
      ? validateConsume(event.request)
      : event.action === 'abandon'
        ? validateAbandon(event.request)
        : paper
          ? validatePaperHistory(event.request)
          : null;
  const allocation = paper ? null : validateAllocation(event.allocation),
    binding = paper ? null : validateBinding(event.binding);
  if (
    !request ||
    !same(event.scope, scope) ||
    request.operationId !== event.operationId ||
    event.allocationId !== (allocation?.allocationId ?? null) ||
    (!paper && !same(binding, (request as import('./types.ts').ReserveInput).binding)) ||
    event.requestDigest !== requestDigest(request)
  )
    throw new FiscalAllocationError('invalid_input');
  if (paper) {
    verifyPaperInput(request as import('./types.ts').PaperHistoryInput, a.verification.paperTrust);
    if (
      event.receipt !== null ||
      event.binding !== null ||
      event.allocation !== null ||
      !same((request as import('./types.ts').PaperHistoryInput).scope, scope)
    )
      throw new FiscalAllocationError('invalid_input');
  }
  if (reservation) {
    const r = request as import('./types.ts').ReserveInput;
    if (
      !same(r.scope, scope) ||
      !same(
        allocation!.series,
        r.bases.map((b) => ({
          code: b.code + '-' + allocation!.installationIdentity,
          purpose: b.purpose,
        })),
      )
    )
      throw new FiscalAllocationError('invalid_input');
  } else if (
    !paper &&
    (request as import('./types.ts').ConsumeInput).allocationId !== allocation!.allocationId
  )
    throw new FiscalAllocationError('invalid_input');
  const history = await requireCurrentHistory(a, scope, grant);
  const prior = history.events.find((e) => e.operationId === event.operationId);
  if (prior) {
    if (prior.requestDigest !== event.requestDigest)
      throw new FiscalAllocationError('binding_conflict');
    return { event: prior, receipt: prior.receipt!, witness: history.witness };
  }
  if (paper) checkPaperProgress(history.events, request as import('./types.ts').PaperHistoryInput);
  const predecessor = history.events.find(
    (e) => BigInt(e.sequence) + 1n === BigInt(event.sequence),
  );
  if (
    BigInt(event.sequence) <= BigInt(history.witness.sequence) &&
    event.previousDigest === (predecessor ? eventDigest(predecessor) : genesis) &&
    (!reservation ||
      event.allocation?.installationIdentity ===
        'C' +
          String((predecessor?.receipt?.payload.continuity.cHighWater ?? 0) + 1).padStart(6, '0'))
  )
    throw new FiscalAllocationError('allocation_unavailable');
  if (reservation && history.witness.cHighWater === 999999)
    throw new FiscalAllocationError('space_exhausted');
  if (
    event.sequence !== String(BigInt(history.witness.sequence) + 1n) ||
    event.previousDigest !== history.witness.historyDigest ||
    (reservation &&
      event.allocation?.installationIdentity !==
        'C' + String(history.witness.cHighWater + 1).padStart(6, '0')) ||
    event.requestDigest !== requestDigest(event.request)
  )
    uncertain();
  let failed = false,
    definiteContention = false;
  try {
    await bounded(a, async () => {
      try {
        return await a.claim({
          scope,
          writerGrant: grant,
          expectedSequence: history.witness.sequence,
          operationId: event.operationId,
          requestDigest: event.requestDigest,
          event,
        });
      } catch (e) {
        definiteContention = (e as { code?: string }).code === 'allocation_unavailable';
        throw e;
      }
    });
  } catch {
    failed = true;
  }
  let current: ContinuityHistory;
  try {
    current = await requireCurrentHistory(a, scope, grant);
  } catch {
    uncertain();
  }
  const committed = current.events.find((e) => e.operationId === event.operationId);
  if (!committed) {
    if (failed && definiteContention) throw new FiscalAllocationError('allocation_unavailable');
    uncertain();
  }
  if (committed.requestDigest !== event.requestDigest)
    throw new FiscalAllocationError('binding_conflict');
  if (!same({ ...committed, receipt: null }, { ...event, receipt: null })) uncertain();
  return {
    event: committed,
    receipt: committed.receipt!,
    witness: current.witness,
  };
}
export async function projectHistory(
  client: PoolClient,
  history: ContinuityHistory,
): Promise<void> {
  if (!verified.has(history)) uncertain();
  function fresh() {
    const d = deadlines.get(history);
    if (
      !d ||
      performance.now() > d.monotonic ||
      Math.abs(Date.now() - Date.parse(history.witness.observedAt)) > d.maxAge
    )
      uncertain();
  }
  fresh();
  const w = history.witness,
    scope = w.scope,
    params = [scope.taxpayerNif, scope.softwareId, scope.environment];
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    canonical(['fiscal-namespace', scope]),
  ]);
  await client.query(
    'INSERT INTO fiscal_registry_scopes(taxpayer_nif,software_id,environment,c_high_water,sequence,history_digest,writer_fence) VALUES($1,$2,$3,0,0,$4,0) ON CONFLICT DO NOTHING',
    [...params, genesis],
  );
  const local = (
    await client.query(
      'SELECT c_high_water,sequence::text,history_digest,writer_fence::text FROM fiscal_registry_scopes WHERE taxpayer_nif=$1 AND software_id=$2 AND environment=$3 FOR UPDATE',
      params,
    )
  ).rows[0];
  fresh();
  const prefix = history.events.find((e) => e.sequence === local.sequence);
  if (
    BigInt(local.sequence) > BigInt(w.sequence) ||
    BigInt(local.writer_fence) > BigInt(w.writerFence) ||
    local.history_digest !== (prefix ? eventDigest(prefix) : genesis) ||
    local.c_high_water !==
      history.events.filter(
        (e) => e.action === 'reserve' && BigInt(e.sequence) <= BigInt(local.sequence),
      ).length
  )
    uncertain();
  for (const e of history.events) {
    const p = e.receipt?.payload,
      a = e.allocation!;
    if (e.action === 'reserve') {
      const row = {
        allocation_id: a.allocationId,
        taxpayer_nif: scope.taxpayerNif,
        software_id: scope.softwareId,
        environment: scope.environment,
        installation_identity: a.installationIdentity,
        venue_id: p!.venueId,
        account_id: p!.cloudAccountId,
        allocation: a,
        binding: e.binding,
        custody_version: p!.custodyVersion,
        entitlement_version: p!.entitlementVersion,
        initial_receipt: e.receipt,
      };
      await client.query(
        'INSERT INTO fiscal_registry_allocations(allocation_id,taxpayer_nif,software_id,environment,installation_identity,venue_id,account_id,allocation,binding,custody_version,entitlement_version,initial_receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING',
        Object.values(row),
      );
      const existing = (
        await client.query(
          'SELECT to_jsonb(t) AS value FROM fiscal_registry_allocations t WHERE allocation_id=$1',
          [a.allocationId],
        )
      ).rows[0]?.value;
      if (!same(existing, row)) uncertain();
    }
    if (e.action === 'paper-import') {
      const x = e.request as import('./types.ts').PaperHistoryInput;
      const fact = {
        event_id: e.eventId,
        taxpayer_nif: scope.taxpayerNif,
        software_id: scope.softwareId,
        environment: scope.environment,
        custodian_id: x.block.payload.custodianId,
        register_revision: x.registerRevision,
        block_digest: requestDigest(x.block.payload),
        event_digest: e.requestDigest,
        fact: x,
      };
      await client.query(
        'INSERT INTO fiscal_registry_paper_events(event_id,taxpayer_nif,software_id,environment,custodian_id,register_revision,block_digest,event_digest,fact) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
        Object.values(fact),
      );
      const existing = (
        await client.query(
          "SELECT to_jsonb(t)||jsonb_build_object('register_revision',register_revision::text) AS value FROM fiscal_registry_paper_events t WHERE event_id=$1",
          [e.eventId],
        )
      ).rows[0]?.value;
      if (!same(existing, fact)) uncertain();
    }
    const expected = {
      event_id: e.eventId,
      taxpayer_nif: scope.taxpayerNif,
      software_id: scope.softwareId,
      environment: scope.environment,
      sequence: e.sequence,
      operation_id: e.operationId,
      action: e.action,
      request_digest: e.requestDigest,
      allocation_id: e.allocationId,
      event: e,
      result:
        e.action === 'paper-import'
          ? paperResult(e.request as import('./types.ts').PaperHistoryInput)
          : e.receipt,
    };
    await client.query(
      'INSERT INTO fiscal_registry_events(event_id,taxpayer_nif,software_id,environment,sequence,operation_id,action,request_digest,allocation_id,event,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',
      Object.values(expected),
    );
    const existingEvent = (
      await client.query(
        "SELECT to_jsonb(t)||jsonb_build_object('sequence',sequence::text) AS value FROM fiscal_registry_events t WHERE event_id=$1",
        [e.eventId],
      )
    ).rows[0]?.value;
    if (!same(existingEvent, expected)) uncertain();
  }
  const counts = (
    await client.query(
      'SELECT (SELECT count(*) FROM fiscal_registry_events WHERE taxpayer_nif=$1 AND software_id=$2 AND environment=$3)::text AS events,(SELECT count(*) FROM fiscal_registry_allocations WHERE taxpayer_nif=$1 AND software_id=$2 AND environment=$3)::text AS allocations',
      params,
    )
  ).rows[0];
  if (
    counts.events !== String(history.events.length) ||
    counts.allocations !== String(history.events.filter((e) => e.action === 'reserve').length)
  )
    uncertain();
  fresh();
  await client.query(
    'UPDATE fiscal_registry_scopes SET c_high_water=$4,sequence=$5,history_digest=$6,writer_fence=$7 WHERE taxpayer_nif=$1 AND software_id=$2 AND environment=$3',
    [...params, w.cHighWater, w.sequence, w.historyDigest, w.writerFence],
  );
}
