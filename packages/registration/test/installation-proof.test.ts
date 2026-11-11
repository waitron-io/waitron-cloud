import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {InstallationError as SharedInstallationError} from '@waitron-io/contract';
import {InstallationError,createLeaseIssuer,createLeaseTrust,encodeMachine,verifyMachine,verifyLease,readMachineClaims,type MachineClaims} from '../src/installation-proof.ts';
const key=generateKeyPairSync('ed25519'),other=generateKeyPairSync('ed25519');
const publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
const issuer=createLeaseIssuer(other.privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const now=1800000000000,origin='https://cloud.example.test';
const leaseClaims={origin,leaseId:randomUUID(),installationId:randomUUID(),venueId:randomUUID(),environment:'test' as const,publicKey,issuedAt:now,expiresAt:now+3600000};
const lease=issuer.issue(leaseClaims);
const claims:MachineClaims={origin,action:'configuration',installationId:leaseClaims.installationId,operationId:randomUUID(),issuedAt:now,lease:JSON.stringify(lease),body:'{}'};
function proof(c=claims){const bytes=encodeMachine(c);return {payload:bytes.toString('base64url'),signature:sign(null,bytes,key.privateKey).toString('base64url')};}
test('Cloud trust refusals use the installed contract error identity',()=>{
 assert.equal(InstallationError,SharedInstallationError);
 assert.throws(()=>createLeaseTrust(issuer,'not-json'),SharedInstallationError);
});
test('address lookup uses the existing signed namespace and cannot be relabelled as another action',()=>{
 const value={...claims,action:'address-lookup' as const,body:JSON.stringify({version:1,kind:'suggest',workflowId:randomUUID(),query:'Calle de Prueba',language:'es'})};
 const signed=proof(value);
 assert.deepEqual(readMachineClaims(signed),value);assert.deepEqual(verifyMachine(signed,publicKey,origin,'address-lookup',now),value);
 assert.throws(()=>verifyMachine(signed,publicKey,origin,'configuration',now));
 assert.throws(()=>verifyMachine(signed,publicKey,'https://other.test','address-lookup',now));
 assert.throws(()=>verifyMachine(signed,publicKey,origin,'address-lookup',now+60001));
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
test('operator trust configuration derives key identifiers and always includes the active issuer',()=>{
  const next=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const trusted=createLeaseTrust(issuer,JSON.stringify([next.publicKey]));
  assert.deepEqual([...trusted.keys()].sort(),[issuer.keyId,next.keyId].sort());
  assert.equal(trusted.get(next.keyId),next.publicKey);
  for(const value of ['{}','["invalid"]','[1]',JSON.stringify(Array(9).fill(next.publicKey))])assert.throws(()=>createLeaseTrust(issuer,value));
});
test('managed stream actions use the same signed machine namespace',()=>{
  for(const action of ['backup-stream-configure','backup-stream-observe'] as const){
    const value={...claims,action};const signed=proof(value);
    assert.equal(readMachineClaims(signed).action,action);
    assert.equal(verifyMachine(signed,publicKey,origin,action,now).action,action);
  }
});

test('translation actions use the same signed machine namespace and cannot cross actions',()=>{
  for(const action of ['translation-submit','translation-status','translation-collect','translation-release'] as const){
    const value={...claims,action};const signed=proof(value);
    assert.equal(readMachineClaims(signed).action,action);
    assert.equal(verifyMachine(signed,publicKey,origin,action,now).action,action);
    assert.throws(()=>verifyMachine(signed,publicKey,origin,'configuration',now));
    assert.throws(()=>verifyMachine(signed,publicKey,origin,action,now+60001));
    assert.throws(()=>verifyMachine(signed,publicKey,'https://other.test',action,now));
    assert.throws(()=>verifyMachine(signed,other.publicKey.export({type:'spki',format:'der'}).toString('base64url'),origin,action,now));
  }
});

test('box error and held actions stay bound to their signed action and origin',()=>{
 for(const action of ['error-report','release-held'] as const){
  const c={...claims,action} as MachineClaims,signed=proof(c);
  assert.equal(readMachineClaims(signed).action,action);
  assert.equal(verifyMachine(signed,publicKey,origin,action,now).action,action);
  assert.throws(()=>verifyMachine(signed,publicKey,origin,'report',now));
  assert.throws(()=>verifyMachine(signed,publicKey,origin,action,now+60001));
  assert.throws(()=>verifyMachine(signed,publicKey,'https://elsewhere.example.test',action,now));
 }
});
