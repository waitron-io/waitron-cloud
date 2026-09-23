import assert from 'node:assert/strict';
import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import {test} from 'node:test';
import {pairingPayload, verifyPairingProof, type PairingClaims} from '../src/pairing-proof.ts';
const keys=generateKeyPairSync('ed25519');
const origin='https://cloud.example.test';
const now=Date.now();
const claims:PairingClaims={origin,action:'start',requestId:randomUUID(),publicKey:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:now};
function proof(c=claims){const bytes=pairingPayload(c);return {payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')};}
const verify=(p=proof(),o=origin,a='start')=>verifyPairingProof(p.payload,p.signature,o,a,now);
test('signed canonical Ed25519 request round trips and binds every field',()=>{
  assert.deepEqual(verify(),claims);
  for(const change of [{requestId:randomUUID()},{code:'87654321'},{localVenueId:randomUUID()},{environment:'production'}]) {
    const changed=proof({...claims,...change} as PairingClaims);assert.throws(()=>verify({...changed,signature:proof().signature}));
  }
  assert.throws(()=>verify(proof(),'https://other.example.test'));
  assert.throws(()=>verify(proof(),origin,'complete'));
  const other=generateKeyPairSync('ed25519');assert.throws(()=>verify({...proof(),signature:sign(null,pairingPayload(claims),other.privateKey).toString('base64url')}));
});
test('refuses expired/future, invalid shapes, versions, algorithms and noncanonical encodings',()=>{
  for(const change of [{issuedAt:now-60001},{issuedAt:now+60001},{issuedAt:1.5},{requestId:'bad'},{environment:'dev'},{code:'123'},{organisationId:randomUUID()},{publicKey:'a'.repeat(300)}]) assert.throws(()=>verify(proof({...claims,...change} as PairingClaims)));
  for(const body of [[],{},['v2'],JSON.parse(pairingPayload(claims).toString()).concat('extra')]) {
    const bytes=Buffer.from(JSON.stringify(body));assert.throws(()=>verify({payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')}));
  }
  assert.throws(()=>verify({...proof(),payload:proof().payload+'='}));
  assert.throws(()=>verify({...proof(),signature:proof().signature+'='}));
  const rsa=generateKeyPairSync('rsa',{modulusLength:1024});
  assert.throws(()=>verify(proof({...claims,publicKey:rsa.publicKey.export({type:'spki',format:'der'}).toString('base64url')})));
});
test('status carries no code or chosen business; completion requires both chosen IDs',()=>{
  const status={...claims,action:'status',code:''} as PairingClaims;assert.deepEqual(verify(proof(status),origin,'status'),status);
  assert.throws(()=>verify(proof({...status,code:'12345678'}),origin,'status'));
  const complete={...status,action:'complete',organisationId:randomUUID(),legalBusinessId:randomUUID()} as PairingClaims;
  assert.deepEqual(verify(proof(complete),origin,'complete'),complete);
  for(const key of ['organisationId','legalBusinessId']) assert.throws(()=>verify(proof({...complete,[key]:''}),origin,'complete'));
});
test('matches the fixed wire vector shared with the Waitron adapter',async()=>{
  const {readFile}=await import('node:fs/promises');
  const v=JSON.parse(await readFile(new URL('./pairing-vector.json',import.meta.url),'utf8'));
  assert.equal(pairingPayload(v.claims).toString('base64url'),v.payload);
  assert.deepEqual(verifyPairingProof(v.payload,v.signature,v.claims.origin,v.claims.action,v.claims.issuedAt),v.claims);
});
