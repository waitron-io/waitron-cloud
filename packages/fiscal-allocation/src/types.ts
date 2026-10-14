export type Environment = 'preproduction' | 'production';
export interface Scope {
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: Environment;
}
export interface SeriesBase {
  readonly code: string;
  readonly purpose: 'standard' | 'full' | 'rectificative';
}
export type OperationOperator = string | {
  readonly kind: 'recovery-key';
  readonly nodeId: string;
  readonly eventId: string;
};
export interface ClaimBinding {
  readonly eventId: string;
  readonly operatorId: OperationOperator;
  readonly sourceId: string;
  readonly targetNodeId: string;
  readonly incidentEvidence: string;
}
export interface ReserveInput {
  readonly version: 1;
  readonly operationId: string;
  readonly venueId: string;
  readonly scope: Scope;
  readonly bases: readonly SeriesBase[];
  readonly binding: ClaimBinding;
  readonly mode: 'initial-setup' | 'recovery';
}
export interface ConsumeInput {
  readonly version: 1;
  readonly operationId: string;
  readonly allocationId: string;
  readonly binding: ClaimBinding;
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly noParallelRecovery: boolean;
  readonly confirmedAt: string;
}
export interface AbandonInput {
  readonly version: 1;
  readonly operationId: string;
  readonly allocationId: string;
  readonly binding: ClaimBinding;
}
export interface StatusInput {
  readonly version: 1;
  readonly venueId: string;
  readonly operationId: string;
}
export interface ListInput {
  readonly version: 1;
  readonly venueId: string;
  readonly cursor: string | null;
  readonly limit: number;
}
export interface FiscalAllocation {
  readonly version: 1;
  readonly allocationId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: Environment;
  readonly installationIdentity: string;
  readonly series: readonly SeriesBase[];
  readonly source: 'initial-paper' | 'paper' | 'cloud' | 'emergency';
  readonly reservationEvidence: unknown;
  readonly issuedAt: string;
}
export interface RecoveryApproval extends ClaimBinding {
  readonly version: 1;
  readonly oldMachineOffline: boolean;
  readonly oldMachineAbsent: boolean;
  readonly noParallelRecovery: boolean;
  readonly confirmedAt: string;
}
export interface ContinuityWitness {
  readonly authorityId: string;
  readonly scope: Scope;
  readonly sequence: string;
  readonly cHighWater: number;
  readonly historyDigest: string;
  readonly writerFence: string;
  readonly requestNonce: string;
  readonly observedAt: string;
  readonly keyId: string;
  readonly signature: string;
}
export interface ReceiptPayload {
  readonly version: 1;
  readonly issuer: string;
  readonly receiptId: string;
  readonly state: 'reserved' | 'consumed' | 'abandoned';
  readonly allocation: FiscalAllocation;
  readonly binding: ClaimBinding;
  readonly mode: 'initial-setup' | 'recovery';
  readonly approval: RecoveryApproval | null;
  readonly cloudAccountId: string;
  readonly venueId: string;
  readonly custodyVersion: string;
  readonly entitlementVersion: string;
  readonly continuity: ContinuityWitness;
  readonly recordedAt: string;
}
export interface AllocationReceipt {
  readonly payload: ReceiptPayload;
  readonly keyId: string;
  readonly signature: string;
}
export interface AllocationPage {
  readonly version: 1;
  readonly items: readonly AllocationReceipt[];
  readonly nextCursor: string | null;
}
export interface StatusResult {
  readonly version: 1;
  readonly state: 'unknown' | 'recorded' | 'uncertain';
  readonly receipt: AllocationReceipt | null;
}
export interface PaperImportResult {
  readonly version: 1;
  readonly importId: string;
  readonly acceptedRevision: string;
  readonly historyDigest: string;
}
export type PaperAllocation = Omit<FiscalAllocation, 'reservationEvidence' | 'source'> & {
  readonly source: 'initial-paper' | 'paper';
};
export interface PaperBlock {
  readonly version: 1;
  readonly custodianId: string;
  readonly generationId: string;
  readonly blockId: string;
  readonly packVersion: 1;
  readonly recipientVenueId: string;
  readonly allocations: readonly PaperAllocation[];
}
export interface SignedPaperValue<T> {
  readonly payload: T;
  readonly signature: string;
}
export interface PaperConsumption extends ClaimBinding {
  readonly version: 1;
  readonly custodianId: string;
  readonly blockDigest: string;
  readonly allocationId: string;
  readonly consumedAt: string;
}
export interface PaperTransfer {
  readonly version: 1;
  readonly custodianId: string;
  readonly blockDigest: string;
  readonly allocationIds: readonly string[];
  readonly fromVenueId: string;
  readonly toVenueId: string;
  readonly registerRevision: string;
  readonly previousDigest: string;
  readonly transferredAt: string;
}
export interface SignedPaperTransfer extends SignedPaperValue<PaperTransfer> {
  readonly keyId: string;
}
export interface PaperHistoryInput {
  readonly version: 1;
  readonly operationId: string;
  readonly venueId: string;
  readonly scope: Scope;
  readonly custodyVersion: string;
  readonly registerRevision: string;
  readonly previousDigest: string;
  readonly block: SignedPaperValue<PaperBlock>;
  readonly consumptions: readonly SignedPaperValue<PaperConsumption>[];
  readonly transfers: readonly SignedPaperTransfer[];
}
export interface FiscalReportBody {
  readonly venueId: string;
  readonly scope: Scope;
  readonly receipt: AllocationReceipt | null;
  readonly paperHistory: PaperHistoryInput | null;
  readonly activationEvidence: unknown;
}
export interface FiscalReportProof {
  readonly payload: string;
  readonly signature: string;
}
export interface FiscalReportClaims {
  readonly version: 1;
  readonly origin: string;
  readonly action: 'report';
  readonly installationId: string;
  readonly operationId: string;
  readonly issuedAt: number;
  readonly lease: string;
  readonly bodyDigest: string;
  readonly body: FiscalReportBody;
}
export interface ReportResult {
  readonly version: 1;
  readonly state: 'matched' | 'conflict' | 'recorded';
  readonly receiptId: string | null;
}
export type FiscalErrorCode =
  | 'invalid_input'
  | 'permission_denied'
  | 'entitlement_unavailable'
  | 'custody_unavailable'
  | 'continuity_unavailable'
  | 'history_uncertain'
  | 'binding_conflict'
  | 'allocation_unavailable'
  | 'space_exhausted'
  | 'reservation_untrusted';
export class FiscalAllocationError extends Error {
  readonly code: FiscalErrorCode;
  constructor(code: FiscalErrorCode) {
    super(code);
    this.name = 'FiscalAllocationError';
    this.code = code;
  }
}
