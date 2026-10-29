import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as api from '../src/index.ts';

// A missing package boundary must not prevent the adapter from projecting an owned venue.
test('package consumers project a registered venue at country midnight',()=>{
 const module=api as Record<string,any>;
 assert.equal(typeof module.projectBillingDisplay,'function','billing display package export must exist');
 const today=module.billingDisplayDay('2026-10-31T23:00:00.000Z','Europe/Madrid');
 assert.equal(today,'2026-11-01');
 assert.deepEqual(module.projectBillingDisplay({venue:{organisationId:'org',legalBusinessId:'business',venueId:'venue',revision:0,level:'registered',connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null},trials:[],charges:[]},today),{status:'ready',level:'registered',state:'active',period:null});
});

import {readFileSync} from 'node:fs';
import {createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {encodeMachine,readMachineClaims,verifyMachine,verifyLease} from '../src/installation-proof.ts';
const vector=JSON.parse(readFileSync(new URL('./billing-display-vector.json',import.meta.url),'utf8'));
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.alloc(32,vector.machineSeedByte)]),type:'pkcs8',format:'der'});
// A new action must reuse the signed domain and bind every field, including the exact body.
test('billing display fixed vector preserves the machine domain and lease binding',()=>{
 assert.equal(createPublicKey(key).export({type:'spki',format:'der'}).toString('base64url'),vector.publicKey);
 assert.equal(encodeMachine(vector.claims).toString('base64url'),vector.envelope.payload);
 assert.equal(sign(null,encodeMachine(vector.claims),key).toString('base64url'),vector.envelope.signature);
 assert.deepEqual(readMachineClaims(vector.envelope),vector.claims);
 assert.deepEqual(verifyMachine(vector.envelope,vector.publicKey,vector.claims.origin,'billing-display' as any,vector.claims.issuedAt),vector.claims);
 const lease=verifyLease(JSON.parse(vector.claims.lease),new Map([[vector.issuerKeyId,vector.issuerPublicKey]]),vector.claims.origin,vector.claims.issuedAt);
 assert.equal(lease.installationId,vector.claims.installationId);assert.equal(lease.venueId,vector.venueId);assert.equal(lease.publicKey,vector.publicKey);
});
for(const [name,value] of Object.entries({origin:'https://other.example.test',action:'configuration',installationId:'10000000-0000-4000-8000-000000000009',operationId:'40000000-0000-4000-8000-000000000009',issuedAt:vector.claims.issuedAt+1,lease:vector.claims.lease+' ',body:'{"version":2}'})){
 test(`billing display rejects unsigned ${name} change`,()=>{
  const payload=encodeMachine({...vector.claims,[name]:value}).toString('base64url');
  assert.throws(()=>verifyMachine({...vector.envelope,payload},vector.publicKey,vector.claims.origin,'billing-display' as any,vector.claims.issuedAt),{code:'invalid_proof'});
 });
}
test('billing display rejects cross-action use and a one-byte signature change',()=>{
 assert.throws(()=>verifyMachine(vector.envelope,vector.publicKey,vector.claims.origin,'configuration',vector.claims.issuedAt),{code:'invalid_proof'});
 const signature=Buffer.from(vector.envelope.signature,'base64url');signature[0]^=1;
 assert.throws(()=>verifyMachine({...vector.envelope,signature:signature.toString('base64url')},vector.publicKey,vector.claims.origin,'billing-display' as any,vector.claims.issuedAt),{code:'invalid_proof'});
});
