import { createPublicKey, verify, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { transaction } from '../../registration/src/transaction.ts';
import { verifyLease, InstallationError } from '../../registration/src/installation-proof.ts';
import type { RegistryOptions, RegistryEvent, ContinuityAuthority } from './policy.ts';
import { requireCapabilities } from './policy.ts';
import type { FiscalReportClaims, FiscalReportBody, ReportResult } from './types.ts';
import { FiscalAllocationError } from './types.ts';
import { canonical, decodeReceipt, encodeReceipt } from './evidence.ts';
import {
  record,
  encoded,
  uuid,
  digest,
  validateScope,
  validateReceipt,
  validatePaperHistory,
  snapshot,
  mapEnvironment,
} from './validation.ts';
import {
  requestDigest,
  fenceWriter,
  requireCurrentHistory,
  appendEvent,
  projectHistory,
} from './continuity.ts';
import { verifyPaperInput } from './paper-import.ts';

function invalid(): never {
  throw new InstallationError('invalid_proof');
}
function same(a: unknown, b: unknown) {
  return canonical(a) === canonical(b);
}
// Renewed authentication cannot change an operation's evidence or installation binding.
export function reportRequestDigest(c: FiscalReportClaims): string {
  return requestDigest([
    'waitron.fiscal-report-operation',
    1,
    c.origin,
    c.action,
    c.installationId,
    c.operationId,
    c.bodyDigest,
  ]);
}
export function readFiscalReport(value: unknown): FiscalReportClaims {
  try {
    const e = record(value, ['payload', 'signature']),
      bytes = Buffer.from(encoded(e.payload), 'base64url');
    if (bytes.length > 16384 || Buffer.from(encoded(e.signature), 'base64url').length !== 64)
      invalid();
    const a: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !Array.isArray(a) ||
      a.length !== 10 ||
      a[0] !== 'waitron.fiscal-machine-report' ||
      a[1] !== 1 ||
      a[3] !== 'report' ||
      canonical(a) !== bytes.toString('utf8')
    )
      invalid();
    const [, , origin, , installationId, operationId, issuedAt, lease, bodyDigest, body] = a;
    if (
      typeof origin !== 'string' ||
      origin.length > 256 ||
      new URL(origin).origin !== origin ||
      !['http:', 'https:'].includes(new URL(origin).protocol) ||
      !Number.isSafeInteger(issuedAt) ||
      issuedAt < 0 ||
      typeof lease !== 'string' ||
      Buffer.byteLength(lease) > 4096
    )
      invalid();
    const b = record(body, ['venueId', 'scope', 'receipt', 'paperHistory', 'activationEvidence']);
    if ((b.receipt === null) === (b.paperHistory === null)) invalid();
    const parsed: FiscalReportBody = {
      venueId: uuid(b.venueId),
      scope: validateScope(b.scope),
      receipt: b.receipt === null ? null : validateReceipt(b.receipt),
      paperHistory: b.paperHistory === null ? null : validatePaperHistory(b.paperHistory),
      activationEvidence: b.activationEvidence,
    };
    if (requestDigest(parsed) !== digest(bodyDigest)) invalid();
    return snapshot({
      version: 1,
      origin,
      action: 'report',
      installationId: uuid(installationId),
      operationId: uuid(operationId),
      issuedAt,
      lease,
      bodyDigest,
      body: parsed,
    });
  } catch {
    return invalid();
  }
}
export function verifyFiscalReport(
  value: unknown,
  currentKey: string,
  origin: string,
  now: number = Date.now(),
): FiscalReportClaims {
  try {
    const c = readFiscalReport(value),
      e = record(value, ['payload', 'signature']);
    const key = createPublicKey({
      key: Buffer.from(encoded(currentKey), 'base64url'),
      type: 'spki',
      format: 'der',
    });
    if (
      c.origin !== origin ||
      Math.abs(now - c.issuedAt) > 60000 ||
      key.asymmetricKeyType !== 'ed25519' ||
      !verify(
        null,
        Buffer.from(e.payload as string, 'base64url'),
        key,
        Buffer.from(e.signature as string, 'base64url'),
      )
    )
      invalid();
    return c;
  } catch {
    return invalid();
  }
}
export function historicalFiscalReport(
  value: unknown,
  machine: RegistryOptions['machine'],
  now: number,
): FiscalReportClaims {
  if (!machine) throw new FiscalAllocationError('continuity_unavailable');
  const routing = readFiscalReport(value);
  let lease: unknown;
  try {
    lease = JSON.parse(routing.lease);
    if (JSON.stringify(lease) !== routing.lease) invalid();
  } catch {
    return invalid();
  }
  const claims = verifyLease(lease, machine.leaseTrust, machine.origin, now);
  const c = verifyFiscalReport(value, claims.publicKey, machine.origin, now);
  if (claims.installationId !== c.installationId || claims.venueId !== c.body.venueId) invalid();
  mapEnvironment(claims.environment, c.body.scope.environment);
  return c;
}
export function reportResult(
  events: readonly RegistryEvent[],
  body: FiscalReportBody,
): ReportResult {
  if (body.receipt) {
    const p = body.receipt.payload;
    const latest = events
      .filter((e) => e.action !== 'report' && e.allocationId === p.allocation.allocationId)
      .at(-1);
    return {
      version: 1,
      state: p.state === 'consumed' && same(latest?.receipt, body.receipt) ? 'matched' : 'conflict',
      receiptId: p.receiptId,
    };
  }
  const x = body.paperHistory!;
  const existing = events
    .filter((e) => e.action === 'paper-import')
    .map((e) => e.request as import('./types.ts').PaperHistoryInput);
  if (existing.some((e) => same(e, x))) return { version: 1, state: 'matched', receiptId: null };
  // A report never imports its supplied register or changes a consumed fact.
  const conflict = existing.some(
    (e) =>
      e.block.payload.allocations.some((old) =>
        x.block.payload.allocations.some(
          (n) =>
            (old.allocationId === n.allocationId ||
              old.installationIdentity === n.installationIdentity) &&
            !same(old, n),
        ),
      ) ||
      e.consumptions.some((old) =>
        x.consumptions.some(
          (n) => old.payload.allocationId === n.payload.allocationId && !same(old, n),
        ),
      ),
  );
  return {
    version: 1,
    state: conflict ? 'conflict' : 'recorded',
    receiptId: null,
  };
}
export function verifyReportEvidence(
  c: FiscalReportClaims,
  verification: ContinuityAuthority['verification'],
): void {
  const b = c.body;
  try {
    if (b.receipt) {
      const r = decodeReceipt(encodeReceipt(b.receipt), verification.receipts),
        p = r.payload,
        a = p.allocation;
      if (
        p.venueId !== b.venueId ||
        !same(
          {
            taxpayerNif: a.taxpayerNif,
            softwareId: a.softwareId,
            environment: a.environment,
          },
          b.scope,
        )
      )
        invalid();
    } else {
      const x = b.paperHistory!;
      if (x.venueId !== b.venueId || !same(x.scope, b.scope)) invalid();
      verifyPaperInput(
        x,
        verification.paperHistoryTrust?.get(x.custodyVersion) ?? verification.paperTrust,
      );
    }
  } catch {
    return invalid();
  }
}
async function locked(c: PoolClient, options: RegistryOptions, proof: unknown) {
  if (!options.machine) throw new FiscalAllocationError('continuity_unavailable');
  const routing = readFiscalReport(proof);
  const row = (
    await c.query(
      'SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i',
      [routing.installationId],
    )
  ).rows[0];
  if (!row) invalid();
  if (row.revoked_at || row.superseded_by) throw new FiscalAllocationError('permission_denied');
  function check() {
    const now = Date.now(),
      claims = verifyFiscalReport(proof, row.public_key, options.machine!.origin, now);
    historicalFiscalReport(proof, options.machine, now);
    if (
      row.venue_id !== claims.body.venueId ||
      !row.lease_expires_at ||
      row.lease_expires_at.getTime() <= now
    )
      invalid();
    mapEnvironment(row.environment, claims.body.scope.environment);
    return claims;
  }
  return { claims: check(), check };
}
export async function authenticateFiscalReport(
  pool: Pool,
  options: RegistryOptions,
  proof: unknown,
): Promise<FiscalReportClaims> {
  return transaction(pool, async (c) => (await locked(c, options, proof)).claims);
}
export async function reportFiscalAllocation(
  pool: Pool,
  options: RegistryOptions,
  proof: unknown,
): Promise<ReportResult> {
  return transaction(pool, async (c) => {
    const active = await locked(c, options, proof),
      claims = active.claims,
      scope = claims.body.scope;
    const caps = requireCapabilities(options),
      a = caps.continuity;
    const authority: ContinuityAuthority = {
      ...a,
      verification: {
        ...a.verification,
        paperTrust: options.paperTrust ?? undefined,
        paperHistoryTrust: options.paperHistoryTrust,
        machine: options.machine ?? undefined,
      },
      current: (...args) => a.current(...args),
      history: (...args) => a.history(...args),
      fence: (...args) => a.fence(...args),
      claim: (...args) => a.claim(...args),
    };
    verifyReportEvidence(claims, authority.verification);
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      canonical(['fiscal-namespace', scope]),
    ]);
    const grant = await fenceWriter(authority, scope),
      history = await requireCurrentHistory(authority, scope, grant);
    await projectHistory(c, history);
    active.check();
    const prior = history.events.find((e) => e.operationId === claims.operationId);
    if (prior) {
      if (prior.action !== 'report' || prior.requestDigest !== reportRequestDigest(claims))
        throw new FiscalAllocationError('binding_conflict');
      return reportResult(
        history.events.filter((e) => BigInt(e.sequence) < BigInt(prior.sequence)),
        claims.body,
      );
    }
    const receipt = claims.body.receipt;
    const event: RegistryEvent = {
      eventId: randomUUID(),
      scope,
      sequence: String(BigInt(history.witness.sequence) + 1n),
      operationId: claims.operationId,
      action: 'report',
      requestDigest: reportRequestDigest(claims),
      request: proof,
      allocationId: receipt?.payload.allocation.allocationId ?? null,
      allocation: receipt?.payload.allocation ?? null,
      binding: receipt?.payload.binding ?? null,
      recordedAt: new Date().toISOString(),
      previousDigest: history.witness.historyDigest,
      receipt: null,
    };
    // Unknown cloud receipts remain report evidence without an allocation foreign-key claim.
    if (
      receipt &&
      !history.events.some((e) => e.action === 'reserve' && e.allocationId === event.allocationId)
    )
      throw new FiscalAllocationError('binding_conflict');
    await appendEvent(authority, scope, grant, event);
    active.check();
    await projectHistory(c, await requireCurrentHistory(authority, scope, grant));
    active.check();
    return reportResult(history.events, claims.body);
  });
}
