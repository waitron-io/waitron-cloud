import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {createLeaseIssuer,encodeMachine,verifyMachine,verifyLease,readMachineClaims,type MachineClaims} from '../src/installation-proof.ts';
const key=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const issuer=createLeaseIssuer(other.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const now=1800000000000,origin='https://cloud.example.test';
const leaseClaims={origin,leaseId:randomUUID(),installationId:randomUUID(),venueId:randomUUID(),environment:'test' as const,publicKey,issuedAt:now,expiresAt:now+3600000};
const lease=issuer.issue(leaseClaims);
const claims:MachineClaims={origin,action:'configuration',installationId:leaseClaims.installationId,operationId:randomUUID(),issuedAt:now,lease:JSON.stringify(lease),body:'{}'};
function proof(c=claims){const bytes=encodeMachine(c);return {payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')};}
function verify(p=proof(),time=now){return verifyMachine(p,publicKey,origin,'configuration',time);}
test('a lease binds the issuer, installation key and scope; the machine proves possession separately',()=>{
  const trusted=new Map([[issuer.keyId,issuer.publicKey]]);
  assert.deepEqual(verifyLease(lease,trusted,origin,now),{...leaseClaims,keyId:issuer.keyId,audience:'control'});
  assert.deepEqual(verify(),claims);
  assert.deepEqual(readMachineClaims(proof()),claims);
  const bytes=encodeMachine(claims);
  assert.throws(()=>verify({...proof(),signature:sign(null,bytes,other.privateKey).toString('base64url')}));
  assert.throws(()=>verifyMachine(proof(),other.publicKey.export({type:'spki',format:'der'}).toString('base64url'),origin,'configuration',now));
  assert.throws(()=>verifyLease(lease,new Map(),origin,now));
  assert.throws(()=>verifyLease(lease,new Map([[issuer.keyId,publicKey]]),origin,now));
  assert.throws(()=>verifyLease(lease,trusted,'https://other.test',now));
});
test('rejects expired or future authority and requests, including exactly expired leases',()=>{
  const trusted=new Map([[issuer.keyId,issuer.publicKey]]);
  assert.throws(()=>verifyLease(lease,trusted,origin,leaseClaims.expiresAt));
  assert.throws(()=>verifyLease(lease,trusted,origin,now-60001));
  assert.throws(()=>verify(proof(),now+60001));assert.throws(()=>verify(proof(),now-60001));
  assert.throws(()=>verifyMachine(proof(),publicKey,origin,'report',now));
  assert.throws(()=>verifyMachine(proof(),publicKey,'https://other.test','configuration',now));
});
test('every machine field is signed and malformed or noncanonical encodings are refused',()=>{
  for(const change of [{origin:'https://other.test'},{action:'report' as const},{installationId:randomUUID()},{operationId:randomUUID()},{issuedAt:now+1},{lease:''},{body:'{"x":1}'}]){
    const changed=proof({...claims,...change});assert.throws(()=>verify({...changed,signature:proof().signature}));
  }
  for(const values of [[],{},['v2'],JSON.parse(encodeMachine(claims).toString()).concat('extra')]){
    const bytes=Buffer.from(JSON.stringify(values));assert.throws(()=>verify({payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')}));
  }
  for(const change of [{operationId:'bad'},{issuedAt:1.5},{body:' '.repeat(10000)},{lease:'x'.repeat(10000)}])assert.throws(()=>verify(proof({...claims,...change})));
  assert.throws(()=>verify({...proof(),payload:proof().payload+'='}));
  assert.throws(()=>verify({...proof(),signature:proof().signature+'='}));
  const bytes=Buffer.from(' '+encodeMachine(claims).toString());assert.throws(()=>verify({payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')}));
  assert.throws(()=>readMachineClaims({...proof(),extra:'unexpected'}));
});
test('issuer rejects invalid identities, durations and algorithms; lease claims cannot be changed',()=>{
  const trusted=new Map([[issuer.keyId,issuer.publicKey]]);
  for(const change of [{installationId:'bad'},{venueId:'bad'},{expiresAt:now},{expiresAt:now+3600001},{environment:'dev'},{publicKey:'bad'}])assert.throws(()=>issuer.issue({...leaseClaims,...change} as typeof leaseClaims));
  const rsa=generateKeyPairSync('rsa',{modulusLength:1024});assert.throws(()=>createLeaseIssuer(rsa.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')));
  for(const index of [1,2,3,4,5,6,7,8,9,10]){
    const values=JSON.parse(Buffer.from(lease.payload,'base64url').toString());values[index]=index===8||index===9?now+1:'changed';
    assert.throws(()=>verifyLease({...lease,payload:Buffer.from(JSON.stringify(values)).toString('base64url')},trusted,origin,now));
  }
});

test('literal installation and lease vectors remain compatible across repositories',async()=>{
  const {readFile}=await import('node:fs/promises');
  const v=JSON.parse(await readFile(new URL('./installation-vector.json',import.meta.url),'utf8'));
  assert.equal(encodeMachine(v.claims).toString('base64url'),v.proof.payload);
  assert.deepEqual(verifyMachine(v.proof,v.publicKey,v.claims.origin,'configuration',v.claims.issuedAt),v.claims);
  const fixedIssuer=createLeaseIssuer(v.issuerPrivateKey);assert.equal(fixedIssuer.keyId,v.issuerKeyId);
  assert.deepEqual(fixedIssuer.issue(v.leaseClaims),v.lease);
  assert.deepEqual(verifyLease(v.lease,new Map([[v.issuerKeyId,v.issuerPublicKey]]),v.claims.origin,v.claims.issuedAt),{...v.leaseClaims,keyId:v.issuerKeyId,audience:'control'});
});
