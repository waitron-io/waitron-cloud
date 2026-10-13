// A test-only process owns this journal independently of registry workers and PostgreSQL.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createPrivateKey, sign, randomUUID } from 'node:crypto';
import { canonical, signReceipt } from '../src/evidence.ts';
import { checkPaperProgress } from '../src/paper-import.ts';
import { key, scope, payload } from './fixtures.ts';
import type { RegistryEvent, WriterGrant, ContinuityClaim } from '../src/policy.ts';
import type { ContinuityWitness, ReserveInput } from '../src/types.ts';
import { readFiscalReport, reportRequestDigest } from '../src/machine-proof.ts';

const directory = process.argv[2]!;
const file = join(directory, 'authority.json');
const state: {
  signer: ReturnType<typeof key>;
  events: RegistryEvent[];
  fence: string;
  writerId: string;
  expiresAt: string;
  highWater: number;
  digest: string;
} = existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8'))
  : {
      signer: key(),
      events: [],
      fence: '0',
      writerId: 'none',
      expiresAt: new Date(0).toISOString(),
      highWater: 0,
      digest: '0'.repeat(64),
    };
let fault = 'none';
let oldWitness: ContinuityWitness | undefined;
function save() {
  const temporary = file + '.tmp';
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, file);
}
function signature(value: unknown) {
  return sign(
    null,
    Buffer.from(canonical(value)),
    createPrivateKey({
      key: Buffer.from(state.signer.privateKey, 'base64url'),
      type: 'pkcs8',
      format: 'der',
    }),
  ).toString('base64url');
}
function core(event: RegistryEvent) {
  const { receipt: _, ...fields } = event;
  return fields;
}
function hashed(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function witness(nonce: string): ContinuityWitness {
  const value = {
    authorityId: 'fixture-authority',
    scope,
    sequence: String(state.events.length),
    cHighWater: state.highWater,
    historyDigest: state.digest,
    writerFence: state.fence,
    requestNonce: nonce,
    observedAt: new Date(
      Date.now() + (fault === 'stale' ? -60000 : fault === 'future' ? 60000 : 0),
    ).toISOString(),
    keyId: state.signer.keyId,
  };
  if (fault === 'wrong-nonce') value.requestNonce = 'replayed-nonce';
  if (fault === 'wrong-scope') value.scope = { ...scope, taxpayerNif: '12345678A' };
  if (fault === 'wrong-digest') value.historyDigest = 'f'.repeat(64);
  if (fault === 'changed-high-water') value.cHighWater++;
  if (fault === 'wrong-key') value.keyId = 'd'.repeat(64);
  return {
    ...value,
    signature:
      fault === 'unsigned'
        ? Buffer.alloc(64).toString('base64url')
        : signature(['waitron.fiscal-continuity-witness', 1, value]),
  };
}
function grant(nonce: string): WriterGrant {
  const value = {
    writerId: state.writerId,
    fence: state.fence,
    expiresAt: state.expiresAt,
    witness: witness(nonce),
    keyId: state.signer.keyId,
  };
  const result = {
    ...value,
    signature: signature(['waitron.fiscal-continuity-writer', 1, value]),
  };
  if (fault === 'writer-id') result.writerId = 'substitution';
  if (fault === 'writer-expiry') result.expiresAt = new Date(Date.now() + 86400000).toISOString();
  return result;
}
function reserveEvent(input: ReserveInput, accountId: string, identity: string): RegistryEvent {
  const p = payload();
  const now = new Date().toISOString(),
    sequence = String(state.events.length + 1);
  const allocation = {
    ...p.allocation,
    allocationId: randomUUID(),
    installationIdentity: identity,
    series: input.bases.map((b) => ({
      code: b.code + '-' + identity,
      purpose: b.purpose,
    })),
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
    requestDigest: hashed(input),
    request: input,
    allocationId: allocation.allocationId,
    allocation,
    binding: input.binding,
    recordedAt: now,
    previousDigest: state.digest,
    receipt: null,
  };
  state.highWater = Number(identity.slice(1));
  state.digest = hashed(['waitron.fiscal-continuity-event', 1, core(event)]);
  state.events.push(event);
  (event as { receipt: unknown }).receipt = signReceipt(
    {
      ...p,
      allocation,
      binding: input.binding,
      mode: input.mode,
      cloudAccountId: accountId,
      venueId: input.venueId,
      receiptId: randomUUID(),
      continuity: witness('event-' + sequence),
      recordedAt: now,
    },
    state.signer,
  );
  return event;
}
function append(claim: ContinuityClaim) {
  const g = claim.writerGrant;
  if (
    g.writerId !== state.writerId ||
    g.fence !== state.fence ||
    Date.parse(g.expiresAt) <= Date.now() ||
    g.expiresAt !== state.expiresAt
  )
    throw Object.assign(Error(), { code: 'history_uncertain' });
  const original = state.events.find((e) => e.operationId === claim.operationId);
  if (original) {
    if (original.requestDigest !== claim.requestDigest)
      throw Object.assign(Error(), { code: 'binding_conflict' });
    return {
      event: original,
      receipt: original.receipt,
      witness: witness('append'),
    };
  }
  const e = claim.event;
  if (claim.expectedSequence !== String(state.events.length))
    throw Object.assign(Error(), { code: 'allocation_unavailable' });
  if (
    e.sequence !== String(state.events.length + 1) ||
    e.previousDigest !== state.digest ||
    (e.action === 'reserve' &&
      e.allocation?.installationIdentity !== 'C' + String(state.highWater + 1).padStart(6, '0'))
  )
    throw Object.assign(Error(), { code: 'history_uncertain' });
  if (
    e.requestDigest !==
      (e.action === 'report'
        ? reportRequestDigest(readFiscalReport(e.request))
        : hashed(e.request)) ||
    claim.requestDigest !== e.requestDigest ||
    claim.operationId !== e.operationId ||
    e.allocationId !== (e.allocation?.allocationId ?? null)
  )
    throw Object.assign(Error(), { code: 'invalid_input' });
  if (e.action === 'paper-import') {
    checkPaperProgress(state.events, e.request as import('../src/types.ts').PaperHistoryInput);
  } else if (e.action !== 'reserve' && e.action !== 'report') {
    const prior = state.events.filter((x) => x.allocationId === e.allocationId).at(-1);
    if (
      !prior ||
      prior.receipt!.payload.state !== 'reserved' ||
      !['consume', 'abandon'].includes(e.action) ||
      canonical(prior.allocation) !== canonical(e.allocation) ||
      canonical(prior.binding) !== canonical(e.binding)
    )
      throw Object.assign(Error(), { code: 'binding_conflict' });
  }
  const p = e.receipt?.payload;
  state.digest = hashed(['waitron.fiscal-continuity-event', 1, core(e)]);
  if (e.action === 'reserve') state.highWater++;
  state.events.push(e);
  const receipt = p
    ? signReceipt({ ...p, continuity: witness('event-' + e.sequence) }, state.signer)
    : null;
  (e as { receipt: unknown }).receipt = receipt;
  save();
  return { event: e, receipt, witness: witness('append') };
}
const server = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const b = JSON.parse(raw);
    let value: unknown;
    switch (req.url) {
      case '/fault':
        fault = b.fault;
        oldWitness = b.old;
        value = { ok: true };
        break;
      case '/seed':
        for (let n = 1; n <= b.count; n++)
          reserveEvent(
            { ...b.input, operationId: randomUUID() },
            b.accountId,
            'C' + String(n).padStart(6, '0'),
          );
        save();
        value = { ok: true };
        break;
      case '/current': {
        value = witness(b.nonce);
        if (fault === 'divergent-current-prefix') {
          const { signature: _, ...core } = oldWitness!;
          const wrong = {
            ...core,
            requestNonce: b.nonce,
            historyDigest: 'f'.repeat(64),
            observedAt: new Date().toISOString(),
          };
          value = {
            ...wrong,
            signature: signature(['waitron.fiscal-continuity-witness', 1, wrong]),
          };
        }
        break;
      }
      case '/fence':
        state.fence = String(BigInt(state.fence) + 1n);
        state.writerId = randomUUID();
        state.expiresAt = new Date(
          Date.now() + (fault === 'expired-writer' ? -1 : 60000),
        ).toISOString();
        save();
        value = grant(b.nonce);
        break;
      case '/history': {
        if (fault === 'history-outage')
          throw Object.assign(Error(), { code: 'continuity_unavailable' });
        const events = structuredClone(state.events);
        if (fault === 'missing-event') events.splice(5, 1);
        if (fault === 'changed-request')
          (events[0]!.request as { binding: unknown }).binding = {
            ...events[0]!.binding!,
            sourceId: 'forged',
          };
        if (fault === 'changed-receipt')
          (events[0]!.receipt!.payload as { custodyVersion: string }).custodyVersion = 'forged';
        if (fault === 'changed-allocation')
          (events[0]!.allocation as { installationIdentity: string }).installationIdentity =
            'C000099';
        if (fault === 'duplicate-operation')
          (events[1] as { operationId: string }).operationId = events[0]!.operationId;
        if (fault === 'unknown-event-key') Object.assign(events[0]!, { extra: 'not-signed' });
        value = { events, witness: witness(b.nonce) };
        break;
      }
      case '/claim':
        value = append(b);
        if (fault === 'lost-reply' || fault === 'lost-reply-and-history-outage') {
          fault = fault === 'lost-reply' ? 'none' : 'history-outage';
          req.socket.destroy();
          return;
        }
        break;
      default:
        throw Error('unknown fixture endpoint');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(value));
  } catch (e) {
    res.statusCode = 409;
    res.end(
      JSON.stringify({
        code: (e as { code?: string }).code ?? 'invalid_input',
      }),
    );
  }
});
server.listen(0, '127.0.0.1', () => {
  const address = server.address() as { port: number };
  console.log(
    JSON.stringify({
      url: 'http://127.0.0.1:' + address.port,
      publicKey: state.signer.publicKey,
      keyId: state.signer.keyId,
    }),
  );
});
process.once('SIGTERM', () => server.close(() => process.exit(0)));
