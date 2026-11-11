import {createHash,createPublicKey,type KeyObject} from 'node:crypto';
import {InstallationError,type LeaseIssuer} from '@waitron-io/contract';
export {InstallationError,createLeaseIssuer,readMachineClaims,encodeMachine,verifyMachine,verifyLease,type MachineAction,type SignedEnvelope,type MachineClaims,type LeaseInput,type LeaseClaims,type LeaseIssuer} from '@waitron-io/contract';

function invalid():never {throw new InstallationError('invalid_proof');}
function decode(value:unknown,max:number):Buffer {
  if(typeof value!=='string'||!value.length||value.length>max||!/^[A-Za-z0-9_-]+$/.test(value))return invalid();
  const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)return invalid();return bytes;
}
function publicKey(value:string):KeyObject {
  const bytes=decode(value,128),key=createPublicKey({key:bytes,type:'spki',format:'der'});
  if(key.asymmetricKeyType!=='ed25519'||!key.export({type:'spki',format:'der'}).equals(bytes))return invalid();return key;
}
export function createLeaseTrust(issuer:LeaseIssuer,encoded?:string):ReadonlyMap<string,string> {
  const trusted=new Map([[issuer.keyId,issuer.publicKey]]);
  if(encoded===undefined||encoded==='')return trusted;
  let values:unknown;try{values=JSON.parse(encoded);}catch{return invalid();}
  if(!Array.isArray(values)||values.length>8)return invalid();
  for(const value of values){
    if(typeof value!=='string')return invalid();
    const key=publicKey(value),bytes=key.export({type:'spki',format:'der'});
    trusted.set(createHash('sha256').update(bytes).digest('base64url'),bytes.toString('base64url'));
  }
  return trusted;
}
