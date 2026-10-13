import { buildAltaRecord, validate, type AltaInput } from '@waitron/verifactu';
import { FiscalAllocationError } from './types.ts';
import type {
  Scope,
  Environment,
  SeriesBase,
  ClaimBinding,
  ReserveInput,
  FiscalAllocation,
  ReceiptPayload,
  AllocationReceipt,
  ContinuityWitness,
  RecoveryApproval,
  PaperHistoryInput,
  PaperBlock,
  PaperConsumption,
  PaperTransfer,
  PaperAllocation,
} from './types.ts';
export function fail(code: 'invalid_input' | 'binding_conflict' = 'invalid_input'): never {
  throw new FiscalAllocationError(code);
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
  const o = value as Record<string, unknown>;
  if (Object.keys(o).length !== keys.length || keys.some((k) => !Object.hasOwn(o, k))) fail();
  return o;
}
export function text(value: unknown, max = 256): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail();
  return value;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    fail();
  return value;
}
export function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
  return value;
}
export function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) fail();
  return value;
}
export function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail();
  return value;
}
export function encoded(value: unknown, size?: number): string {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (size !== undefined && bytes.length !== size))
    fail();
  return value;
}
export function snapshot<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) snapshot(child);
    Object.freeze(value);
  }
  return value;
}
export function bounded(value: unknown, max: number): void {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > max) fail();
  } catch {
    fail();
  }
}
export function validateScope(value: unknown): Scope {
  const o = record(value, ['taxpayerNif', 'softwareId', 'environment']);
  if (
    typeof o.taxpayerNif !== 'string' ||
    !/^[A-Z0-9]{9}$/.test(o.taxpayerNif) ||
    typeof o.softwareId !== 'string' ||
    !/^[A-Z0-9]{2}$/.test(o.softwareId) ||
    !['preproduction', 'production'].includes(o.environment as string)
  )
    fail();
  return snapshot({
    taxpayerNif: o.taxpayerNif,
    softwareId: o.softwareId,
    environment: o.environment as Environment,
  });
}
export function validateBinding(value: unknown): ClaimBinding {
  const o = record(value, [
    'eventId',
    'operatorId',
    'sourceId',
    'targetNodeId',
    'incidentEvidence',
  ]);
  return snapshot({
    eventId: text(o.eventId),
    operatorId: text(o.operatorId),
    sourceId: text(o.sourceId),
    targetNodeId: text(o.targetNodeId),
    incidentEvidence: text(o.incidentEvidence),
  });
}
export function series(value: unknown, allocated = false): readonly SeriesBase[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) fail();
  const seen = new Set<string>();
  const result = value.map((v) => {
    const o = record(v, ['code', 'purpose']);
    const code = text(o.code, allocated ? 49 : 21);
    if (
      !/^[A-Za-z0-9/_.-]+$/.test(code) ||
      !['standard', 'full', 'rectificative'].includes(o.purpose as string) ||
      seen.has(code)
    )
      fail();
    seen.add(code);
    return { code, purpose: o.purpose as SeriesBase['purpose'] };
  });
  if (!result.some((x) => x.purpose === 'standard')) fail();
  return snapshot(result);
}
export function requireBases(
  requested: readonly SeriesBase[],
  required: readonly SeriesBase[],
): void {
  const a = series(requested),
    b = series(required);
  if (
    a.length !== b.length ||
    a.some((x) => !b.some((y) => x.code === y.code && x.purpose === y.purpose))
  )
    fail('binding_conflict');
}
export function mapEnvironment(registration: string, fiscal: string): Environment {
  if (
    (registration === 'test' && fiscal === 'preproduction') ||
    (registration === 'production' && fiscal === 'production')
  )
    return fiscal as Environment;
  return fail('binding_conflict');
}
export function validateReserve(value: unknown): ReserveInput {
  bounded(value, 16384);
  const o = record(value, [
    'version',
    'operationId',
    'venueId',
    'scope',
    'bases',
    'binding',
    'mode',
  ]);
  if (o.version !== 1 || !['initial-setup', 'recovery'].includes(o.mode as string)) fail();
  return snapshot({
    version: 1,
    operationId: uuid(o.operationId),
    venueId: uuid(o.venueId),
    scope: validateScope(o.scope),
    bases: series(o.bases),
    binding: validateBinding(o.binding),
    mode: o.mode as ReserveInput['mode'],
  });
}
export function validateIdentity(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !(
      (/^[SPC][0-9]{6}$/.test(value) && value.slice(1) !== '000000') ||
      /^E[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}$/.test(value)
    )
  )
    fail();
  return value;
}
// This complete synthetic record tests format compatibility, never taxpayer custody or a live invoice.
export function fiscalCandidate(scope: Scope, identity: string, invoice: string): AltaInput {
  return {
    IDEmisorFactura: scope.taxpayerNif,
    NumSerieFactura: invoice,
    FechaExpedicionFactura: new Date('2026-01-01T00:00:00.000Z'),
    NombreRazonEmisor: 'Synthetic validation',
    TipoFactura: 'F2',
    DescripcionOperacion: 'Synthetic format check',
    Desglose: [
      {
        BaseImponibleOimporteNoSujeto: '102.02',
        CuotaRepercutida: '21.43',
        TipoImpositivo: '21.00',
        ClaveRegimen: '01',
        CalificacionOperacion: 'S1',
      },
    ],
    CuotaTotal: '21.43',
    ImporteTotal: '123.45',
    Encadenamiento: { PrimerRegistro: 'S' },
    SistemaInformatico: {
      NombreRazon: 'Synthetic validation',
      NIF: scope.taxpayerNif,
      NombreSistemaInformatico: 'Waitron',
      IdSistemaInformatico: scope.softwareId,
      Version: '1.0.0',
      NumeroInstalacion: identity,
      TipoUsoPosibleSoloVerifactu: 'S',
      TipoUsoPosibleMultiOT: 'S',
      IndicadorMultiplesOT: 'N',
    },
    generadoEn: new Date('2026-01-01T10:00:00.000Z'),
    offsetMinutes: 0,
  };
}
function allocationCore(o: Record<string, unknown>): Omit<FiscalAllocation, 'reservationEvidence'> {
  if (o.version !== 1) fail();
  const scope = validateScope({
      taxpayerNif: o.taxpayerNif,
      softwareId: o.softwareId,
      environment: o.environment,
    }),
    identity = validateIdentity(o.installationIdentity),
    items = series(o.series, true);
  const prefixes = { 'initial-paper': 'S', paper: 'P', cloud: 'C', emergency: 'E' };
  if (
    !Object.hasOwn(prefixes, o.source as string) ||
    prefixes[o.source as keyof typeof prefixes] !== identity[0]
  )
    fail();
  for (const item of items) {
    const suffix = '-' + identity;
    if (!item.code.endsWith(suffix)) fail();
    const base = item.code.slice(0, -suffix.length);
    series([{ code: base, purpose: 'standard' }]);
    try {
      if (
        validate(buildAltaRecord(fiscalCandidate(scope, identity, item.code + '/9999999999'))).some(
          (x) => x.severity === 'error',
        )
      )
        fail();
    } catch {
      fail();
    }
  }
  return {
    version: 1,
    allocationId: uuid(o.allocationId),
    ...scope,
    installationIdentity: identity,
    series: items,
    source: o.source as FiscalAllocation['source'],
    issuedAt: timestamp(o.issuedAt),
  };
}
export function validateAllocation(value: unknown): FiscalAllocation {
  const o = record(value, [
    'version',
    'allocationId',
    'taxpayerNif',
    'softwareId',
    'environment',
    'installationIdentity',
    'series',
    'source',
    'reservationEvidence',
    'issuedAt',
  ]);
  const result = allocationCore(o);
  // Cloud references are signed once by the enclosing receipt, avoiding recursive evidence.
  if (result.source !== 'cloud') fail();
  const e = record(o.reservationEvidence, [
    'kind',
    'authorityId',
    'reservationId',
    'reservationSequence',
  ]);
  if (e.kind !== 'cloud') fail();
  return snapshot({
    ...result,
    reservationEvidence: {
      kind: 'cloud',
      authorityId: text(e.authorityId),
      reservationId: uuid(e.reservationId),
      reservationSequence: decimal(e.reservationSequence),
    },
  });
}
export function validateWitness(value: unknown): ContinuityWitness {
  const o = record(value, [
    'authorityId',
    'scope',
    'sequence',
    'cHighWater',
    'historyDigest',
    'writerFence',
    'requestNonce',
    'observedAt',
    'keyId',
    'signature',
  ]);
  if (
    !Number.isSafeInteger(o.cHighWater) ||
    Number(o.cHighWater) < 0 ||
    Number(o.cHighWater) > 999999
  )
    fail();
  return snapshot({
    authorityId: text(o.authorityId),
    scope: validateScope(o.scope),
    sequence: decimal(o.sequence),
    cHighWater: o.cHighWater as number,
    historyDigest: digest(o.historyDigest),
    writerFence: decimal(o.writerFence),
    requestNonce: text(o.requestNonce),
    observedAt: timestamp(o.observedAt),
    keyId: digest(o.keyId),
    signature: encoded(o.signature, 64),
  });
}
export function validatePayload(value: unknown): ReceiptPayload {
  const o = record(value, [
    'version',
    'issuer',
    'receiptId',
    'state',
    'allocation',
    'binding',
    'mode',
    'approval',
    'cloudAccountId',
    'venueId',
    'custodyVersion',
    'entitlementVersion',
    'continuity',
    'recordedAt',
  ]);
  if (
    o.version !== 1 ||
    !['reserved', 'consumed', 'abandoned'].includes(o.state as string) ||
    !['initial-setup', 'recovery'].includes(o.mode as string)
  )
    fail();
  const allocation = validateAllocation(o.allocation),
    binding = validateBinding(o.binding),
    continuity = validateWitness(o.continuity);
  if (
    continuity.scope.taxpayerNif !== allocation.taxpayerNif ||
    continuity.scope.softwareId !== allocation.softwareId ||
    continuity.scope.environment !== allocation.environment ||
    continuity.cHighWater < Number(allocation.installationIdentity.slice(1))
  )
    fail();
  const e = allocation.reservationEvidence as { authorityId: string; reservationSequence: string };
  if (
    e.authorityId !== continuity.authorityId ||
    BigInt(e.reservationSequence) > BigInt(continuity.sequence)
  )
    fail();
  let approval: RecoveryApproval | null = null;
  if (o.state === 'consumed') {
    const a = record(o.approval, [
      'version',
      'eventId',
      'operatorId',
      'sourceId',
      'targetNodeId',
      'incidentEvidence',
      'oldMachineOffline',
      'oldMachineAbsent',
      'noParallelRecovery',
      'confirmedAt',
    ]);
    if (
      a.version !== 1 ||
      a.noParallelRecovery !== true ||
      typeof a.oldMachineOffline !== 'boolean' ||
      typeof a.oldMachineAbsent !== 'boolean'
    )
      fail();
    const ab = validateBinding({
      eventId: a.eventId,
      operatorId: a.operatorId,
      sourceId: a.sourceId,
      targetNodeId: a.targetNodeId,
      incidentEvidence: a.incidentEvidence,
    });
    if (
      Object.keys(binding).some(
        (k) => ab[k as keyof ClaimBinding] !== binding[k as keyof ClaimBinding],
      ) ||
      (o.mode === 'recovery' && (!a.oldMachineOffline || a.oldMachineAbsent)) ||
      (o.mode === 'initial-setup' && !a.oldMachineAbsent)
    )
      fail();
    approval = {
      version: 1,
      ...ab,
      oldMachineOffline: a.oldMachineOffline,
      oldMachineAbsent: a.oldMachineAbsent,
      noParallelRecovery: true,
      confirmedAt: timestamp(a.confirmedAt),
    };
  } else if (o.approval !== null) fail();
  return snapshot({
    version: 1,
    issuer: text(o.issuer),
    receiptId: uuid(o.receiptId),
    state: o.state as ReceiptPayload['state'],
    allocation,
    binding,
    mode: o.mode as ReceiptPayload['mode'],
    approval,
    cloudAccountId: uuid(o.cloudAccountId),
    venueId: uuid(o.venueId),
    custodyVersion: text(o.custodyVersion),
    entitlementVersion: text(o.entitlementVersion),
    continuity,
    recordedAt: timestamp(o.recordedAt),
  });
}
export function validateReceipt(value: unknown): AllocationReceipt {
  const o = record(value, ['payload', 'keyId', 'signature']);
  return snapshot({
    payload: validatePayload(o.payload),
    keyId: digest(o.keyId),
    signature: encoded(o.signature, 64),
  });
}
export function validatePaperBlock(value: unknown): PaperBlock {
  const o = record(value, [
    'version',
    'custodianId',
    'generationId',
    'blockId',
    'packVersion',
    'recipientVenueId',
    'allocations',
  ]);
  if (
    o.version !== 1 ||
    o.packVersion !== 1 ||
    !Array.isArray(o.allocations) ||
    o.allocations.length < 1 ||
    o.allocations.length > 20
  )
    fail();
  const allocations = o.allocations.map((x) => {
    const a = record(x, [
      'version',
      'allocationId',
      'taxpayerNif',
      'softwareId',
      'environment',
      'installationIdentity',
      'series',
      'source',
      'issuedAt',
    ]);
    const core = allocationCore(a);
    if (!['initial-paper', 'paper'].includes(core.source)) fail();
    return core as PaperAllocation;
  });
  if (
    new Set(allocations.map((x) => x.allocationId)).size !== allocations.length ||
    new Set(allocations.map((x) => x.installationIdentity)).size !== allocations.length
  )
    fail();
  return snapshot({
    version: 1,
    custodianId: text(o.custodianId),
    generationId: text(o.generationId),
    blockId: text(o.blockId),
    packVersion: 1,
    recipientVenueId: uuid(o.recipientVenueId),
    allocations,
  });
}
export function validatePaperConsumption(value: unknown): PaperConsumption {
  const o = record(value, [
    'version',
    'custodianId',
    'blockDigest',
    'allocationId',
    'eventId',
    'operatorId',
    'sourceId',
    'targetNodeId',
    'incidentEvidence',
    'consumedAt',
  ]);
  if (o.version !== 1) fail();
  return snapshot({
    version: 1,
    custodianId: text(o.custodianId),
    blockDigest: digest(o.blockDigest),
    allocationId: uuid(o.allocationId),
    ...validateBinding({
      eventId: o.eventId,
      operatorId: o.operatorId,
      sourceId: o.sourceId,
      targetNodeId: o.targetNodeId,
      incidentEvidence: o.incidentEvidence,
    }),
    consumedAt: timestamp(o.consumedAt),
  });
}
export function validatePaperTransfer(value: unknown): PaperTransfer {
  const o = record(value, [
    'version',
    'custodianId',
    'blockDigest',
    'allocationIds',
    'fromVenueId',
    'toVenueId',
    'registerRevision',
    'previousDigest',
    'transferredAt',
  ]);
  if (
    o.version !== 1 ||
    !Array.isArray(o.allocationIds) ||
    !o.allocationIds.length ||
    o.allocationIds.length > 20
  )
    fail();
  const ids = o.allocationIds.map(uuid);
  if (new Set(ids).size !== ids.length) fail();
  return snapshot({
    version: 1,
    custodianId: text(o.custodianId),
    blockDigest: digest(o.blockDigest),
    allocationIds: ids,
    fromVenueId: uuid(o.fromVenueId),
    toVenueId: uuid(o.toVenueId),
    registerRevision: decimal(o.registerRevision),
    previousDigest: digest(o.previousDigest),
    transferredAt: timestamp(o.transferredAt),
  });
}
export function validatePaperHistory(value: unknown): PaperHistoryInput {
  bounded(value, 16384);
  const o = record(value, [
    'version',
    'operationId',
    'venueId',
    'scope',
    'custodyVersion',
    'registerRevision',
    'previousDigest',
    'block',
    'consumptions',
    'transfers',
  ]);
  if (
    o.version !== 1 ||
    !Array.isArray(o.consumptions) ||
    o.consumptions.length > 20 ||
    !Array.isArray(o.transfers) ||
    o.transfers.length > 20
  )
    fail();
  const b = record(o.block, ['payload', 'signature']),
    block = { payload: validatePaperBlock(b.payload), signature: encoded(b.signature, 64) },
    scope = validateScope(o.scope);
  for (const a of block.payload.allocations)
    if (
      a.taxpayerNif !== scope.taxpayerNif ||
      a.softwareId !== scope.softwareId ||
      a.environment !== scope.environment
    )
      fail();
  const consumptions = o.consumptions.map((x) => {
    const c = record(x, ['payload', 'signature']);
    return { payload: validatePaperConsumption(c.payload), signature: encoded(c.signature, 64) };
  });
  const transfers = o.transfers.map((x) => {
    const t = record(x, ['payload', 'keyId', 'signature']);
    return {
      payload: validatePaperTransfer(t.payload),
      keyId: digest(t.keyId),
      signature: encoded(t.signature, 64),
    };
  });
  return snapshot({
    version: 1,
    operationId: uuid(o.operationId),
    venueId: uuid(o.venueId),
    scope,
    custodyVersion: text(o.custodyVersion),
    registerRevision: decimal(o.registerRevision),
    previousDigest: digest(o.previousDigest),
    block,
    consumptions,
    transfers,
  });
}
