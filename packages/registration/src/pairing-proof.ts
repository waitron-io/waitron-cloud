import {createPublicKey, verify} from 'node:crypto';
export type PairingAction = 'start' | 'status' | 'complete';
export interface PairingClaims {
  origin:string; action:PairingAction; requestId:string; publicKey:string; localVenueId:string;
  environment:'test'|'production'; code:string; organisationId:string; legalBusinessId:string; issuedAt:number;
}
export class PairingError extends Error {
  readonly code:'invalid_proof'|'pairing_unavailable'|'binding_conflict'|'approval_required'|'permission_denied';
  constructor(code:PairingError['code']) {super(code);this.code=code;}
}
export const isPairingUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function pairingPayload(c:PairingClaims):Buffer {
  return Buffer.from(JSON.stringify(['waitron-cloud-pair-v1',c.origin,c.action,c.requestId,c.publicKey,c.localVenueId,c.environment,c.code,c.organisationId,c.legalBusinessId,c.issuedAt]));
}
function decode(value:string,max:number):Buffer {
  if(typeof value!=='string'||value.length>max||!value.length||!/^[A-Za-z0-9_-]+$/.test(value))throw new PairingError('invalid_proof');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.toString('base64url')!==value)throw new PairingError('invalid_proof');
  return bytes;
}
export function verifyPairingProof(payload:string,signature:string,origin:string,action:string,now=Date.now()):PairingClaims {
  try {
    const bytes=decode(payload,4096);const values:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!Array.isArray(values)||values.length!==11||values[0]!=='waitron-cloud-pair-v1'
      ||values.slice(0,10).some(v=>typeof v!=='string'))throw new Error();
    const [,audience,operation,requestId,publicKey,localVenueId,environment,code,organisationId,legalBusinessId,issuedAt]=values;
    if(audience!==origin||operation!==action||!['start','status','complete'].includes(operation)
      ||!isPairingUuid(requestId)||!isPairingUuid(localVenueId)||!['test','production'].includes(environment)
      ||!Number.isSafeInteger(issuedAt)||Math.abs(now-issuedAt)>60000)throw new Error();
    if(operation==='start'?(!/^\d{8}$/.test(code)||organisationId!==''||legalBusinessId!==''):
      operation==='status'?(code!==''||organisationId!==''||legalBusinessId!==''):
      (code!==''||!isPairingUuid(organisationId)||!isPairingUuid(legalBusinessId)))throw new Error();
    const keyBytes=decode(publicKey,128);const key=createPublicKey({key:keyBytes,type:'spki',format:'der'});
    if(key.asymmetricKeyType!=='ed25519'||!key.export({type:'spki',format:'der'}).equals(keyBytes))throw new Error();
    const c:PairingClaims={origin:audience,action:operation,requestId,publicKey,localVenueId,environment,code,organisationId,legalBusinessId,issuedAt};
    if(!pairingPayload(c).equals(bytes)||!verify(null,bytes,key,decode(signature,86)))throw new Error();
    return c;
  }catch{throw new PairingError('invalid_proof');}
}
