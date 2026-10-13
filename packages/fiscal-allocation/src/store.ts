import { createPrivateKey, createPublicKey, sign, verify, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { resolveSession } from '../../identity/src/sessions.ts';
import { transaction } from '../../registration/src/transaction.ts';
import type { RegistryOptions, RegistryEvent, CustodyResult } from './policy.ts';
import { requireCapabilities, authorizeCustody } from './policy.ts';
import { FiscalAllocationError } from './types.ts';
import type {
  ReserveInput,
  ConsumeInput,
  AbandonInput,
  StatusInput,
  ListInput,
  Scope,
  ClaimBinding,
  AllocationReceipt,
  AllocationPage,
  StatusResult,
  RecoveryApproval,
  PaperHistoryInput,
  PaperImportResult,
} from './types.ts';
import { canonical, signReceipt, decodeReceipt, encodeReceipt } from './evidence.ts';
import {
  validateReserve,
  validateConsume,
  validateAbandon,
  validateStatus,
  validateList,
  validateAllocation,
  validatePaperHistory,
  mapEnvironment,
  text,
  record,
  encoded,
  timestamp,
  uuid,
} from './validation.ts';
import {
  fenceWriter,
  requireCurrentHistory,
  appendEvent,
  projectHistory,
  requestDigest,
} from './continuity.ts';
import { verifyPaperInput, checkPaperProgress, paperResult } from './paper-import.ts';
function fail(code: import('./types.ts').FiscalErrorCode): never {
  throw new FiscalAllocationError(code);
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
function allocationScope(r: AllocationReceipt): Scope {
  const a = r.payload.allocation;
  return { taxpayerNif: a.taxpayerNif, softwareId: a.softwareId, environment: a.environment };
}
interface Authority {
  accountId: string;
  environment: string;
  custody: CustodyResult;
  entitlementVersion: string;
}
export class FiscalAllocationStore {
  readonly #pool: Pool;
  readonly #options: RegistryOptions;
  constructor(pool: Pool, options: RegistryOptions) {
    this.#pool = pool;
    const a = options.continuity;
    this.#options = {
      ...options,
      continuity: a
        ? {
            verification: {
              ...a.verification,
              paperTrust: options.paperTrust ?? undefined,
              paperHistoryTrust: options.paperHistoryTrust,
            },
            current: (...args) => a.current(...args),
            history: (...args) => a.history(...args),
            fence: (...args) => a.fence(...args),
            claim: (...args) => a.claim(...args),
          }
        : a,
    };
  }
  async #actor(c: PoolClient, token: string, csrf: string, venueId: string) {
    const actor = await resolveSession(c, token, { csrfToken: csrf, touch: false });
    const candidate = (await c.query('SELECT organisation_id FROM venues WHERE id=$1', [venueId]))
      .rows[0];
    if (!candidate) fail('permission_denied');
    if (
      !(
        await c.query(
          'SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',
          [actor.accountId, candidate.organisation_id],
        )
      ).rowCount
    )
      fail('permission_denied');
    const venue = (
      await c.query('SELECT environment,organisation_id FROM venues WHERE id=$1 FOR SHARE', [
        venueId,
      ])
    ).rows[0];
    if (!venue || venue.organisation_id !== candidate.organisation_id) fail('permission_denied');
    await resolveSession(c, token, { csrfToken: csrf, touch: false });
    return { accountId: actor.accountId, environment: venue.environment as string };
  }
  async #authorize(
    c: PoolClient,
    token: string,
    csrf: string,
    venueId: string,
    scope: Scope,
    action: 'reserve' | 'consume' | 'import' | 'read',
    binding?: ClaimBinding,
  ): Promise<Authority> {
    const actor = await this.#actor(c, token, csrf, venueId);
    mapEnvironment(actor.environment, scope.environment);
    if (!this.#options.entitlement) fail('entitlement_unavailable');
    if (!this.#options.custody) fail('custody_unavailable');
    const entitlement = await this.#options.entitlement.check(c, actor.accountId, venueId, action);
    if (!entitlement.allowed) fail('entitlement_unavailable');
    text(entitlement.version);
    const custody = await this.#options.custody.check(c, actor.accountId, venueId, scope, binding);
    try {
      text(custody.custodianId);
      text(custody.custodyVersion);
      if (binding && custody.operatorBindingVerified !== true) throw Error();
    } catch {
      fail('custody_unavailable');
    }
    await resolveSession(c, token, { csrfToken: csrf, touch: false });
    return { ...actor, custody, entitlementVersion: entitlement.version };
  }
  async #namespace(c: PoolClient, scope: Scope) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      canonical(['fiscal-namespace', scope]),
    ]);
  }
  #receipt(value: unknown): AllocationReceipt {
    if (!this.#options.trust) fail('reservation_untrusted');
    return decodeReceipt(encodeReceipt(value as AllocationReceipt), this.#options.trust);
  }
  async reserve(token: string, csrf: string, value: ReserveInput): Promise<AllocationReceipt> {
    const input = validateReserve(value);
    return transaction(this.#pool, async (c) => {
      const before = await this.#authorize(
        c,
        token,
        csrf,
        input.venueId,
        input.scope,
        'reserve',
        input.binding,
      );
      const caps = requireCapabilities(this.#options);
      await this.#namespace(c, input.scope);
      const grant = await fenceWriter(caps.continuity, input.scope);
      let history = await requireCurrentHistory(caps.continuity, input.scope, grant);
      await projectHistory(c, history);
      const prior = history.events.find((e) => e.operationId === input.operationId);
      if (prior) {
        if (
          prior.action !== 'reserve' ||
          prior.requestDigest !== requestDigest(input) ||
          prior.receipt!.payload.venueId !== input.venueId ||
          prior.receipt!.payload.cloudAccountId !== before.accountId
        )
          fail('binding_conflict');
        await this.#authorize(c, token, csrf, input.venueId, input.scope, 'reserve', input.binding);
        return this.#receipt(prior.receipt);
      }
      authorizeCustody(before.custody, input);
      for (let attempt = 0; attempt < 4; attempt++) {
        if (history.witness.cHighWater === 999999) fail('space_exhausted');
        const now = new Date().toISOString(),
          sequence = String(BigInt(history.witness.sequence) + 1n),
          identity = 'C' + String(history.witness.cHighWater + 1).padStart(6, '0');
        const allocation = validateAllocation({
          version: 1,
          allocationId: randomUUID(),
          ...input.scope,
          installationIdentity: identity,
          series: input.bases.map((b) => ({ code: b.code + '-' + identity, purpose: b.purpose })),
          source: 'cloud',
          reservationEvidence: {
            kind: 'cloud',
            authorityId: history.witness.authorityId,
            reservationId: input.operationId,
            reservationSequence: sequence,
          },
          issuedAt: now,
        });
        const event: RegistryEvent = {
          eventId: randomUUID(),
          scope: input.scope,
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
        (event as { receipt: unknown }).receipt = signReceipt(
          {
            version: 1,
            issuer: caps.signer.issuer,
            receiptId: randomUUID(),
            state: 'reserved',
            allocation,
            binding: input.binding,
            mode: input.mode,
            approval: null,
            cloudAccountId: before.accountId,
            venueId: input.venueId,
            custodyVersion: before.custody.custodyVersion,
            entitlementVersion: before.entitlementVersion,
            continuity: {
              ...history.witness,
              sequence,
              cHighWater: history.witness.cHighWater + 1,
            },
            recordedAt: now,
          },
          caps.signer,
        );
        const current = await this.#authorize(
          c,
          token,
          csrf,
          input.venueId,
          input.scope,
          'reserve',
          input.binding,
        );
        if (!same(current, before)) fail('custody_unavailable');
        authorizeCustody(current.custody, input);
        try {
          const result = await appendEvent(caps.continuity, input.scope, grant, event);
          const after = await this.#authorize(
            c,
            token,
            csrf,
            input.venueId,
            input.scope,
            'reserve',
            input.binding,
          );
          if (!same(after, before)) fail('custody_unavailable');
          await projectHistory(c, await requireCurrentHistory(caps.continuity, input.scope, grant));
          await this.#authorize(
            c,
            token,
            csrf,
            input.venueId,
            input.scope,
            'reserve',
            input.binding,
          );
          return this.#receipt(result.receipt);
        } catch (e) {
          if ((e as { code?: string }).code !== 'allocation_unavailable' || attempt === 3) throw e;
          history = await requireCurrentHistory(caps.continuity, input.scope, grant);
        }
      }
      return fail('history_uncertain');
    });
  }
  async consume(token: string, csrf: string, value: ConsumeInput): Promise<AllocationReceipt> {
    return this.#terminal(token, csrf, validateConsume(value), 'consume');
  }
  async abandon(token: string, csrf: string, value: AbandonInput): Promise<AllocationReceipt> {
    return this.#terminal(token, csrf, validateAbandon(value), 'abandon');
  }
  async #terminal(
    token: string,
    csrf: string,
    input: ConsumeInput | AbandonInput,
    action: 'consume' | 'abandon',
  ): Promise<AllocationReceipt> {
    return transaction(this.#pool, async (c) => {
      // A preliminary venue lookup grants no authority; current account and ownership lock first.
      const routing = (
        await c.query(
          'SELECT initial_receipt FROM fiscal_registry_allocations WHERE allocation_id=$1',
          [input.allocationId],
        )
      ).rows[0];
      if (!routing) {
        await resolveSession(c, token, { csrfToken: csrf, touch: false });
        fail('permission_denied');
      }
      const initial = this.#receipt(routing.initial_receipt),
        venueId = initial.payload.venueId,
        scope = allocationScope(initial);
      const before = await this.#authorize(
        c,
        token,
        csrf,
        venueId,
        scope,
        'consume',
        input.binding,
      );
      const caps = requireCapabilities(this.#options);
      await this.#namespace(c, scope);
      const grant = await fenceWriter(caps.continuity, scope),
        history = await requireCurrentHistory(caps.continuity, scope, grant);
      await projectHistory(c, history);
      const retry = history.events.find((e) => e.operationId === input.operationId);
      if (retry) {
        if (
          retry.action !== action ||
          retry.requestDigest !== requestDigest(input) ||
          retry.receipt!.payload.venueId !== venueId
        )
          fail('binding_conflict');
        await this.#authorize(c, token, csrf, venueId, scope, 'consume', input.binding);
        return this.#receipt(retry.receipt);
      }
      const prior = history.events.filter((e) => e.allocationId === input.allocationId).at(-1);
      if (
        !prior ||
        prior.receipt!.payload.state !== 'reserved' ||
        !same(prior.binding, input.binding)
      )
        fail('binding_conflict');
      const p = prior.receipt!.payload;
      const original = history.events.find(
        (e) => e.action === 'reserve' && e.allocationId === input.allocationId,
      )!;
      authorizeCustody(before.custody, original.request as ReserveInput);
      if (action === 'consume') {
        const x = input as ConsumeInput;
        if (
          !x.noParallelRecovery ||
          (p.mode === 'recovery' && (!x.oldMachineOffline || x.oldMachineAbsent)) ||
          (p.mode === 'initial-setup' && !x.oldMachineAbsent)
        )
          fail('invalid_input');
      }
      const now = new Date().toISOString(),
        sequence = String(BigInt(history.witness.sequence) + 1n);
      const event: RegistryEvent = {
        eventId: randomUUID(),
        scope,
        sequence,
        operationId: input.operationId,
        action,
        requestDigest: requestDigest(input),
        request: input,
        allocationId: input.allocationId,
        allocation: p.allocation,
        binding: input.binding,
        recordedAt: now,
        previousDigest: history.witness.historyDigest,
        receipt: null,
      };
      const x = input as ConsumeInput;
      const approval: RecoveryApproval = {
        version: 1,
        ...input.binding,
        oldMachineOffline: x.oldMachineOffline,
        oldMachineAbsent: x.oldMachineAbsent,
        noParallelRecovery: x.noParallelRecovery,
        confirmedAt: x.confirmedAt,
      };
      (event as { receipt: unknown }).receipt = signReceipt(
        {
          ...p,
          issuer: caps.signer.issuer,
          receiptId: randomUUID(),
          state: action === 'consume' ? 'consumed' : 'abandoned',
          cloudAccountId: before.accountId,
          approval: action === 'consume' ? approval : null,
          custodyVersion: before.custody.custodyVersion,
          entitlementVersion: before.entitlementVersion,
          continuity: { ...history.witness, sequence },
          recordedAt: now,
        },
        caps.signer,
      );
      const current = await this.#authorize(
        c,
        token,
        csrf,
        venueId,
        scope,
        'consume',
        input.binding,
      );
      if (!same(current, before)) fail('custody_unavailable');
      const result = await appendEvent(caps.continuity, scope, grant, event);
      const after = await this.#authorize(c, token, csrf, venueId, scope, 'consume', input.binding);
      if (!same(after, before)) fail('custody_unavailable');
      await projectHistory(c, await requireCurrentHistory(caps.continuity, scope, grant));
      await this.#authorize(c, token, csrf, venueId, scope, 'consume', input.binding);
      return this.#receipt(result.receipt);
    });
  }
  async importPaper(
    token: string,
    csrf: string,
    value: PaperHistoryInput,
  ): Promise<PaperImportResult> {
    const input = validatePaperHistory(value);
    return transaction(this.#pool, async (c) => {
      const before = await this.#authorize(c, token, csrf, input.venueId, input.scope, 'import');
      const caps = requireCapabilities(this.#options);
      await this.#namespace(c, input.scope);
      const grant = await fenceWriter(caps.continuity, input.scope),
        history = await requireCurrentHistory(caps.continuity, input.scope, grant);
      await projectHistory(c, history);
      const retry = history.events.find((e) => e.operationId === input.operationId);
      if (retry) {
        if (retry.action !== 'paper-import' || retry.requestDigest !== requestDigest(input))
          fail('binding_conflict');
        await this.#authorize(c, token, csrf, input.venueId, input.scope, 'import');
        return paperResult(input);
      }
      if (
        before.custody.custodianId !== input.block.payload.custodianId ||
        before.custody.custodyVersion !== input.custodyVersion
      )
        fail('custody_unavailable');
      verifyPaperInput(input, this.#options.paperTrust);
      checkPaperProgress(history.events, input);
      const now = new Date().toISOString(),
        sequence = String(BigInt(history.witness.sequence) + 1n);
      const event: RegistryEvent = {
        eventId: randomUUID(),
        scope: input.scope,
        sequence,
        operationId: input.operationId,
        action: 'paper-import',
        requestDigest: requestDigest(input),
        request: input,
        allocationId: null,
        allocation: null,
        binding: null,
        recordedAt: now,
        previousDigest: history.witness.historyDigest,
        receipt: null,
      };
      const current = await this.#authorize(c, token, csrf, input.venueId, input.scope, 'import');
      if (!same(current, before)) fail('custody_unavailable');
      await appendEvent(caps.continuity, input.scope, grant, event);
      const after = await this.#authorize(c, token, csrf, input.venueId, input.scope, 'import');
      if (!same(after, before)) fail('custody_unavailable');
      await projectHistory(c, await requireCurrentHistory(caps.continuity, input.scope, grant));
      await this.#authorize(c, token, csrf, input.venueId, input.scope, 'import');
      return paperResult(input);
    });
  }
  async status(token: string, csrf: string, value: StatusInput): Promise<StatusResult> {
    const input = validateStatus(value);
    return transaction(this.#pool, async (c) => {
      await this.#actor(c, token, csrf, input.venueId);
      const row = (
        await c.query(
          "SELECT result FROM fiscal_registry_events WHERE operation_id=$1 AND result->'payload'->>'venueId'=$2",
          [input.operationId, input.venueId],
        )
      ).rows[0];
      if (!row) return { version: 1, state: 'unknown', receipt: null };
      const receipt = this.#receipt(row.result),
        scope = allocationScope(receipt);
      await this.#authorize(c, token, csrf, input.venueId, scope, 'read');
      await this.#authorize(c, token, csrf, input.venueId, scope, 'read');
      return { version: 1, state: 'recorded', receipt };
    });
  }
  #cursor(value: string | null, accountId: string, venueId: string, limit: number): string {
    if (value === null) return '';
    try {
      const envelope = record(
        JSON.parse(Buffer.from(encoded(value), 'base64url').toString('utf8')),
        ['payload', 'keyId', 'signature'],
      );
      const payload = record(envelope.payload, [
        'version',
        'accountId',
        'venueId',
        'limit',
        'after',
      ]);
      if (
        payload.version !== 1 ||
        payload.accountId !== accountId ||
        payload.venueId !== venueId ||
        payload.limit !== limit
      )
        throw Error();
      const publicKey = this.#options.signer?.publicKey;
      if (
        !publicKey ||
        envelope.keyId !== this.#options.signer?.keyId ||
        !verify(
          null,
          Buffer.from(canonical(['waitron.fiscal-list-cursor', 1, envelope.keyId, payload])),
          createPublicKey({
            key: Buffer.from(publicKey, 'base64url'),
            type: 'spki',
            format: 'der',
          }),
          Buffer.from(encoded(envelope.signature, 64), 'base64url'),
        )
      )
        throw Error();
      const position = text(payload.after, 100);
      const parts = position.split('#');
      if (parts.length !== 2) throw Error();
      timestamp(parts[0]);
      uuid(parts[1]);
      return position;
    } catch {
      return fail('invalid_input');
    }
  }
  #next(accountId: string, venueId: string, limit: number, after: string): string {
    const signer = this.#options.signer;
    if (!signer || !signer.active) fail('reservation_untrusted');
    const payload = { version: 1, accountId, venueId, limit, after };
    const signature = sign(
      null,
      Buffer.from(canonical(['waitron.fiscal-list-cursor', 1, signer.keyId, payload])),
      createPrivateKey({
        key: Buffer.from(signer.privateKey, 'base64url'),
        type: 'pkcs8',
        format: 'der',
      }),
    ).toString('base64url');
    return Buffer.from(canonical({ payload, keyId: signer.keyId, signature })).toString(
      'base64url',
    );
  }
  async list(token: string, csrf: string, value: ListInput): Promise<AllocationPage> {
    const input = validateList(value);
    return transaction(this.#pool, async (c) => {
      const actor = await this.#actor(c, token, csrf, input.venueId),
        after = this.#cursor(input.cursor, actor.accountId, input.venueId, input.limit);
      const rows = (
        await c.query(
          `WITH latest AS (SELECT DISTINCT ON (allocation_id) allocation_id,result, sequence FROM fiscal_registry_events WHERE result->'payload'->>'venueId'=$1 ORDER BY allocation_id, sequence DESC)
        SELECT latest.result,a.allocation->>'issuedAt'||'#'||a.allocation_id::text AS position FROM latest JOIN fiscal_registry_allocations a USING(allocation_id) WHERE a.allocation->>'issuedAt'||'#'||a.allocation_id::text>$2 ORDER BY position LIMIT $3`,
          [input.venueId, after, input.limit + 1],
        )
      ).rows;
      const items: AllocationReceipt[] = [];
      for (const row of rows.slice(0, input.limit)) {
        const receipt = this.#receipt(row.result);
        await this.#authorize(c, token, csrf, input.venueId, allocationScope(receipt), 'read');
        items.push(receipt);
      }
      await this.#actor(c, token, csrf, input.venueId);
      return {
        version: 1,
        items,
        nextCursor:
          rows.length > input.limit
            ? this.#next(
                actor.accountId,
                input.venueId,
                input.limit,
                rows[input.limit - 1]!.position,
              )
            : null,
      };
    });
  }
}
