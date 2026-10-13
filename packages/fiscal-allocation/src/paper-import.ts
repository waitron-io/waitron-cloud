import type {
  PaperHistoryInput,
  PaperImportResult,
  PaperAllocation,
  SignedPaperValue,
  PaperBlock,
  PaperConsumption,
  SignedPaperTransfer,
} from './types.ts';
import { FiscalAllocationError } from './types.ts';
import type { PaperTrust } from './evidence.ts';
import { canonical, verifyPaperValue } from './evidence.ts';
import { requestDigest } from './continuity.ts';
import type { RegistryEvent } from './policy.ts';
function conflict(): never {
  throw new FiscalAllocationError('binding_conflict');
}
function untrusted(): never {
  throw new FiscalAllocationError('reservation_untrusted');
}
function verifyAny(
  value: SignedPaperValue<PaperBlock | PaperConsumption>,
  trust: PaperTrust,
): void {
  for (const keyId of trust.keys.keys()) {
    try {
      verifyPaperValue(value, keyId, trust.custodyVersion, trust);
      return;
    } catch {}
  }
  untrusted();
}
export function verifyPaperInput(
  input: PaperHistoryInput,
  trust: PaperTrust | null | undefined,
): void {
  if (
    !trust ||
    input.custodyVersion !== trust.custodyVersion ||
    input.block.payload.custodianId !== trust.custodianId
  )
    untrusted();
  verifyAny(input.block, trust);
  for (const c of input.consumptions) verifyAny(c, trust);
  for (const t of input.transfers)
    verifyPaperValue(
      { payload: t.payload, signature: t.signature },
      t.keyId,
      input.custodyVersion,
      trust,
    );
}
interface PaperName {
  allocation: PaperAllocation;
  blockDigest: string;
  owner: string;
  consumption: SignedPaperValue<PaperConsumption> | null;
  transfers: SignedPaperTransfer[];
}
export function paperResult(input: PaperHistoryInput): PaperImportResult {
  return {
    version: 1,
    importId: input.operationId,
    acceptedRevision: input.registerRevision,
    historyDigest: requestDigest(input),
  };
}
// Omitted rows are never removals: only new signed facts advance this replayed register.
export function checkPaperProgress(
  events: readonly RegistryEvent[],
  input?: PaperHistoryInput,
): void {
  const names = new Map<string, PaperName>(),
    ids = new Map<string, PaperName>();
  const registers = new Map<string, { revision: bigint; digest: string; custodyVersion: string }>();
  const blocks = new Map<string, string>();
  const inputs = events
    .filter((e) => e.action === 'paper-import')
    .map((e) => e.request as PaperHistoryInput);
  if (input) inputs.push(input);
  for (const x of inputs) {
    const custodian = x.block.payload.custodianId,
      prior = registers.get(custodian),
      revision = BigInt(x.registerRevision);
    if (
      revision !== (prior?.revision ?? 0n) + 1n ||
      x.previousDigest !== (prior?.digest ?? '0'.repeat(64)) ||
      (prior && x.custodyVersion !== prior.custodyVersion)
    )
      conflict();
    const block = x.block.payload,
      blockDigest = requestDigest(block);
    const blockKey = canonical([custodian, block.generationId, block.blockId]);
    const known = blocks.get(blockKey);
    if (known && known !== blockDigest) conflict();
    blocks.set(blockKey, blockDigest);
    const highWaters = new Map(
      ['S', 'P'].map((prefix) => [
        prefix,
        Math.max(
          0,
          ...[...names.keys()].filter((n) => n[0] === prefix).map((n) => Number(n.slice(1))),
        ),
      ]),
    );
    for (const allocation of block.allocations) {
      const existing = names.get(allocation.installationIdentity),
        byId = ids.get(allocation.allocationId);
      if (existing || byId) {
        if (
          !existing ||
          existing !== byId ||
          existing.blockDigest !== blockDigest ||
          canonical(existing.allocation) !== canonical(allocation)
        )
          conflict();
      } else {
        // A later block cannot fill a gap below its already claimed S/P high-water.
        const prefix = allocation.installationIdentity[0],
          serial = Number(allocation.installationIdentity.slice(1));
        const highWater = highWaters.get(prefix!) ?? 0;
        if (serial <= highWater) conflict();
        const name: PaperName = {
          allocation,
          blockDigest,
          owner: block.recipientVenueId,
          consumption: null,
          transfers: [],
        };
        names.set(allocation.installationIdentity, name);
        ids.set(allocation.allocationId, name);
      }
    }
    for (const t of x.transfers) {
      const p = t.payload;
      if (p.custodianId !== custodian || p.blockDigest !== blockDigest) conflict();
      for (const id of p.allocationIds) {
        const n = ids.get(id);
        if (!n || n.blockDigest !== blockDigest) conflict();
        const already = n.transfers.find(
          (old) => old.payload.registerRevision === p.registerRevision,
        );
        if (already) {
          if (canonical(already) !== canonical(t)) conflict();
          continue;
        }
        if (
          n.consumption ||
          p.registerRevision !== x.registerRevision ||
          p.previousDigest !== x.previousDigest ||
          n.owner !== p.fromVenueId ||
          p.fromVenueId === p.toVenueId
        )
          conflict();
        n.owner = p.toVenueId;
        n.transfers.push(t);
      }
    }
    for (const c of x.consumptions) {
      const p = c.payload,
        n = ids.get(p.allocationId);
      if (
        !n ||
        p.custodianId !== custodian ||
        p.blockDigest !== blockDigest ||
        n.blockDigest !== blockDigest ||
        n.owner !== x.venueId
      )
        conflict();
      if (n.consumption && canonical(n.consumption) !== canonical(c)) conflict();
      n.consumption = c;
    }
    if (!block.allocations.some((a) => ids.get(a.allocationId)!.owner === x.venueId)) conflict();
    registers.set(custodian, {
      revision,
      digest: requestDigest(x),
      custodyVersion: x.custodyVersion,
    });
  }
}
