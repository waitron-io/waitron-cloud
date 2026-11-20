export {PairingError,pairingPayload,verifyPairingProof,verifyPairingV4Proof,type PairingAction,type PairingClaims,type PairingV4Claims} from '@waitron-io/contract';
export const isPairingUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
