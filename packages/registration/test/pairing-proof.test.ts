import assert from 'node:assert/strict';
import {createHash,createPrivateKey,sign} from 'node:crypto';
import {test} from 'node:test';
import {pairingPayload,verifyPairingProof} from '../src/pairing-proof.ts';
test('matches the fixed wire vector shared with the Waitron adapter',async()=>{
  const {readFile}=await import('node:fs/promises');
  const v=JSON.parse(await readFile(new URL('./pairing-vector.json',import.meta.url),'utf8'));
  const bytes=Buffer.from(v.payload,'base64url');assert.equal(bytes.length,204);assert.equal(createHash('sha256').update(bytes).digest('hex'),v.digest);
  assert.equal(pairingPayload(v.claims).toString('base64url'),v.payload);
  assert.deepEqual(verifyPairingProof(v.payload,v.signature,v.claims.origin,v.claims.action,v.claims.issuedAt),v.claims);
});
test('the shared verifier refuses v1 and a changed requested Cloud id',async()=>{
  const {readFile}=await import('node:fs/promises');
  const v=JSON.parse(await readFile(new URL('./pairing-vector.json',import.meta.url),'utf8'));
  const key=createPrivateKey({key:Buffer.from(v.privateKey,'base64url'),type:'pkcs8',format:'der'});
  const fields=JSON.parse(Buffer.from(v.payload,'base64url').toString());fields[0]='waitron-cloud-pair-v1';
  const old=Buffer.from(JSON.stringify(fields));
  assert.throws(()=>verifyPairingProof(old.toString('base64url'),sign(null,old,key).toString('base64url'),v.claims.origin,'start',v.claims.issuedAt),/invalid_proof/);
  fields[0]='waitron-cloud-pair-v2';fields[5]='22345678-1234-4234-8234-123456789abc';
  assert.throws(()=>verifyPairingProof(Buffer.from(JSON.stringify(fields)).toString('base64url'),v.signature,v.claims.origin,'start',v.claims.issuedAt),/invalid_proof/);
});
