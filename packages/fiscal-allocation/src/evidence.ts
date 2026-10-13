import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { FiscalAllocationError } from './types.ts';
import type {
  AllocationReceipt,
  ReceiptPayload,
  PaperBlock,
  PaperConsumption,
  PaperTransfer,
} from './types.ts';
import {
  record,
  text,
  digest,
  encoded,
  validatePayload,
  validateReceipt,
  validatePaperBlock,
  validatePaperConsumption,
  validatePaperTransfer,
} from './validation.ts';
export interface ReceiptTrust {
  readonly issuer: string;
  readonly keys: ReadonlyMap<string, string>;
}
export interface ReceiptSigner {
  readonly issuer: string;
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey: string;
  readonly active: boolean;
}
export interface PaperTrust {
  readonly custodianId: string;
  readonly custodyVersion: string;
  readonly keys: ReadonlyMap<string, string>;
}
const prefix = 'WAITRON-FISCAL-ALLOCATION-1:';
function untrusted(): never {
  throw new FiscalAllocationError('reservation_untrusted');
}
// Fixed recursive key order makes the versioned UTF-8 bytes independent of object insertion order.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function fingerprint(publicKey: string): string {
  return createHash('sha256')
    .update(Buffer.from(encoded(publicKey), 'base64url'))
    .digest('hex');
}
function trustedKey(keyId: string, publicKey: string): KeyObject {
  try {
    digest(keyId);
    const bytes = Buffer.from(encoded(publicKey), 'base64url'),
      key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    if (
      key.asymmetricKeyType !== 'ed25519' ||
      !key.export({ format: 'der', type: 'spki' }).equals(bytes) ||
      fingerprint(publicKey) !== keyId
    )
      untrusted();
    return key;
  } catch {
    untrusted();
  }
}
export function receiptSigningBytes(payload: ReceiptPayload, keyId: string): Buffer {
  return Buffer.from(canonical(['waitron.fiscal-allocation-receipt', 1, keyId, payload]), 'utf8');
}
export function signReceipt(value: ReceiptPayload, signer: ReceiptSigner): AllocationReceipt {
  const payload = validatePayload(value);
  if (payload.issuer !== signer.issuer) throw new FiscalAllocationError('invalid_input');
  let privateKey: KeyObject;
  try {
    if (signer.active !== true) untrusted();
    trustedKey(signer.keyId, signer.publicKey);
    const bytes = Buffer.from(encoded(signer.privateKey), 'base64url');
    privateKey = createPrivateKey({ key: bytes, type: 'pkcs8', format: 'der' });
    if (
      privateKey.asymmetricKeyType !== 'ed25519' ||
      !privateKey.export({ format: 'der', type: 'pkcs8' }).equals(bytes) ||
      createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64url') !==
        signer.publicKey
    )
      untrusted();
  } catch {
    untrusted();
  }
  const receipt = validateReceipt({
    payload,
    keyId: signer.keyId,
    signature: sign(null, receiptSigningBytes(payload, signer.keyId), privateKey).toString(
      'base64url',
    ),
  });
  encodeReceipt(receipt);
  return receipt;
}
export function encodeReceipt(value: AllocationReceipt): string {
  const packet =
    prefix + Buffer.from(canonical(validateReceipt(value)), 'utf8').toString('base64url');
  if (Buffer.byteLength(packet) > 12288) throw new FiscalAllocationError('invalid_input');
  return packet;
}
export function decodeReceipt(packet: string, trust: ReceiptTrust): AllocationReceipt {
  try {
    if (
      typeof packet !== 'string' ||
      !packet.startsWith(prefix) ||
      Buffer.byteLength(packet) > 12288
    )
      untrusted();
    const body = encoded(packet.slice(prefix.length)),
      raw = Buffer.from(body, 'base64url');
    const receipt = validateReceipt(JSON.parse(raw.toString('utf8')));
    if (encodeReceipt(receipt) !== packet || receipt.payload.issuer !== trust.issuer) untrusted();
    const publicKey = trust.keys.get(receipt.keyId);
    if (
      !publicKey ||
      !verify(
        null,
        receiptSigningBytes(receipt.payload, receipt.keyId),
        trustedKey(receipt.keyId, publicKey),
        Buffer.from(receipt.signature, 'base64url'),
      )
    )
      untrusted();
    return receipt;
  } catch {
    untrusted();
  }
}
function paperPayload(value: unknown): PaperBlock | PaperConsumption | PaperTransfer {
  if (typeof value === 'object' && value !== null) {
    if (Object.hasOwn(value, 'allocations')) return validatePaperBlock(value);
    if (Object.hasOwn(value, 'allocationIds')) return validatePaperTransfer(value);
  }
  return validatePaperConsumption(value);
}
// These array fields match the inherited version-1 paper protocol; receipt bytes are a separate domain.
export function paperSigningBytes(value: unknown): Buffer {
  const p = paperPayload(value);
  if ('allocations' in p)
    return Buffer.from(
      JSON.stringify([
        'waitron.paper-block',
        p.version,
        p.custodianId,
        p.generationId,
        p.blockId,
        p.packVersion,
        p.recipientVenueId,
        p.allocations.map((a) => [
          a.version,
          a.allocationId,
          a.taxpayerNif,
          a.softwareId,
          a.environment,
          a.installationIdentity,
          a.series.map((s) => [s.code, s.purpose]),
          a.source,
          a.issuedAt,
        ]),
      ]),
      'utf8',
    );
  if ('allocationIds' in p)
    return Buffer.from(
      JSON.stringify([
        'waitron.paper-transfer',
        p.version,
        p.custodianId,
        p.blockDigest,
        p.allocationIds,
        p.fromVenueId,
        p.toVenueId,
        p.registerRevision,
        p.previousDigest,
        p.transferredAt,
      ]),
      'utf8',
    );
  return Buffer.from(
    JSON.stringify([
      'waitron.paper-consumption',
      p.version,
      p.custodianId,
      p.blockDigest,
      p.allocationId,
      p.eventId,
      p.operatorId,
      p.sourceId,
      p.targetNodeId,
      p.incidentEvidence,
      p.consumedAt,
    ]),
    'utf8',
  );
}
export function verifyPaperValue(
  value: unknown,
  keyId: string,
  custodyVersion: string,
  trust: PaperTrust,
): void {
  try {
    const o = record(value, ['payload', 'signature']),
      payload = paperPayload(o.payload);
    text(custodyVersion);
    if (custodyVersion !== trust.custodyVersion || payload.custodianId !== trust.custodianId)
      untrusted();
    const publicKey = trust.keys.get(keyId);
    if (
      !publicKey ||
      !verify(
        null,
        paperSigningBytes(payload),
        trustedKey(keyId, publicKey),
        Buffer.from(encoded(o.signature, 64), 'base64url'),
      )
    )
      untrusted();
  } catch {
    untrusted();
  }
}
