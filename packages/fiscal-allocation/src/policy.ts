import type { PoolClient } from 'pg';
import { FiscalAllocationError } from './types.ts';
import type {
  ReserveInput,
  Scope,
  SeriesBase,
  ClaimBinding,
  ContinuityWitness,
  AllocationReceipt,
} from './types.ts';
import type { ReceiptSigner, ReceiptTrust, PaperTrust } from './evidence.ts';
import { requireBases, text } from './validation.ts';
export interface RegistryPolicy {
  readonly continuityTimeoutMs: number;
  readonly witnessMaxAgeMs: number;
  readonly writerLifetimeMs: number;
}
export interface Entitlement {
  check(
    client: PoolClient,
    accountId: string,
    venueId: string,
    action: 'reserve' | 'consume' | 'import' | 'read',
  ): Promise<{ allowed: boolean; version: string }>;
}
export interface CustodyResult {
  readonly custodianId: string;
  readonly custodyVersion: string;
  readonly operatorBindingVerified: boolean;
  readonly requiredBases: readonly SeriesBase[];
}
export interface Custody {
  check(
    client: PoolClient,
    accountId: string,
    venueId: string,
    scope: Scope,
    binding?: ClaimBinding,
  ): Promise<CustodyResult>;
}
export interface WriterGrant {
  readonly writerId: string;
  readonly fence: string;
  readonly expiresAt: string;
  readonly witness: ContinuityWitness;
  readonly keyId: string;
  readonly signature: string;
}
export interface RegistryEvent {
  readonly eventId: string;
  readonly scope: Scope;
  readonly sequence: string;
  readonly operationId: string;
  readonly action: 'reserve' | 'consume' | 'abandon' | 'paper-import' | 'report';
  readonly requestDigest: string;
  readonly request: unknown;
  readonly allocationId: string | null;
  readonly allocation: import('./types.ts').FiscalAllocation | null;
  readonly binding: ClaimBinding | null;
  readonly recordedAt: string;
  readonly previousDigest: string;
  readonly receipt: AllocationReceipt | null;
}
export interface ContinuityClaim {
  readonly scope: Scope;
  readonly writerGrant: WriterGrant;
  readonly expectedSequence: string;
  readonly operationId: string;
  readonly requestDigest: string;
  readonly event: RegistryEvent;
}
export interface ContinuityResult {
  readonly event: RegistryEvent;
  readonly receipt: AllocationReceipt | null;
  readonly witness: ContinuityWitness;
}
export interface ContinuityHistory {
  readonly events: readonly RegistryEvent[];
  readonly witness: ContinuityWitness;
}
export interface ContinuityAuthority {
  readonly verification: {
    readonly authorityId: string;
    readonly keys: ReadonlyMap<string, string>;
    readonly receipts: ReceiptTrust;
    readonly policy: RegistryPolicy;
    readonly paperTrust?: PaperTrust;
    readonly paperHistoryTrust?: ReadonlyMap<string, PaperTrust>;
  };
  current(scope: Scope, nonce: string): Promise<ContinuityWitness>;
  claim(input: ContinuityClaim): Promise<ContinuityResult>;
  history(scope: Scope, afterSequence: string, nonce: string): Promise<ContinuityHistory>;
  fence(scope: Scope, nonce: string): Promise<WriterGrant>;
}
export interface RegistryOptions {
  readonly entitlement?: Entitlement | null;
  readonly custody?: Custody | null;
  readonly continuity?: ContinuityAuthority | null;
  readonly signer?: ReceiptSigner | null;
  readonly trust?: ReceiptTrust | null;
  readonly paperTrust?: PaperTrust | null;
  readonly paperHistoryTrust?: ReadonlyMap<string, PaperTrust>;
  readonly policy?: RegistryPolicy | null;
}
export function requireCapabilities(options: RegistryOptions): Readonly<{
  entitlement: Entitlement;
  custody: Custody;
  continuity: ContinuityAuthority;
  signer: ReceiptSigner;
  trust: ReceiptTrust;
  policy: RegistryPolicy;
}> {
  if (!options.entitlement) throw new FiscalAllocationError('entitlement_unavailable');
  if (!options.custody) throw new FiscalAllocationError('custody_unavailable');
  if (!options.continuity) throw new FiscalAllocationError('continuity_unavailable');
  if (!options.signer || !options.trust || !options.signer.active)
    throw new FiscalAllocationError('reservation_untrusted');
  const p = options.policy;
  if (
    !p ||
    Object.keys(p).length !== 3 ||
    ![p.continuityTimeoutMs, p.witnessMaxAgeMs, p.writerLifetimeMs].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 86400000,
    ) ||
    p.continuityTimeoutMs > 5000
  )
    throw new FiscalAllocationError('continuity_unavailable');
  return {
    entitlement: options.entitlement,
    custody: options.custody,
    continuity: options.continuity,
    signer: options.signer,
    trust: options.trust,
    policy: p,
  };
}
export function authorizeCustody(result: CustodyResult, input: ReserveInput): void {
  try {
    text(result.custodianId);
    text(result.custodyVersion);
    if (result.operatorBindingVerified !== true) throw Error();
  } catch {
    throw new FiscalAllocationError('custody_unavailable');
  }
  requireBases(input.bases, result.requiredBases);
}
