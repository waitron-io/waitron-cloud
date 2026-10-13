import { createHash, generateKeyPairSync } from 'node:crypto';

export const scope = {
  taxpayerNif: '89890001K',
  softwareId: 'WT',
  environment: 'preproduction' as const,
};
export const bases = [
  { code: 'A', purpose: 'standard' as const },
  { code: 'FF', purpose: 'full' as const },
  { code: 'R', purpose: 'rectificative' as const },
];
export const binding = {
  eventId: 'event-1',
  operatorId: 'operator-1',
  sourceId: 'source-1',
  targetNodeId: 'node-1',
  incidentEvidence: 'incident-1',
};
export const operationId = '10000000-0000-4000-8000-000000000001';
export const venueId = '10000000-0000-4000-8000-000000000002';
export const allocationId = '10000000-0000-4000-8000-000000000003';
export const accountId = '10000000-0000-4000-8000-000000000004';
export const date = '2026-10-13T10:00:00.000Z';
export function reserve() {
  return {
    version: 1 as const,
    operationId,
    venueId,
    scope: { ...scope },
    bases: bases.map((x) => ({ ...x })),
    binding: { ...binding },
    mode: 'recovery' as const,
  };
}
export function key() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  return {
    issuer: 'fixture-registry',
    keyId: createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('hex'),
    publicKey,
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    active: true,
  };
}
export function payload() {
  return {
    version: 1 as const,
    issuer: 'fixture-registry',
    receiptId: '10000000-0000-4000-8000-000000000005',
    state: 'reserved' as const,
    allocation: {
      version: 1 as const,
      allocationId,
      ...scope,
      installationIdentity: 'C000042',
      series: bases.map((b) => ({ code: b.code + '-C000042', purpose: b.purpose })),
      source: 'cloud' as const,
      reservationEvidence: {
        kind: 'cloud' as const,
        authorityId: 'fixture-authority',
        reservationId: operationId,
        reservationSequence: '42',
      },
      issuedAt: date,
    },
    binding: { ...binding },
    mode: 'recovery' as const,
    approval: null,
    cloudAccountId: accountId,
    venueId,
    custodyVersion: 'custody-1',
    entitlementVersion: 'entitlement-1',
    continuity: {
      authorityId: 'fixture-authority',
      scope: { ...scope },
      sequence: '42',
      cHighWater: 42,
      historyDigest: 'a'.repeat(64),
      writerFence: '2',
      requestNonce: 'nonce-1',
      observedAt: date,
      keyId: 'b'.repeat(64),
      signature: Buffer.alloc(64, 1).toString('base64url'),
    },
    recordedAt: date,
  };
}
