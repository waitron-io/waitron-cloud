import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pairingPayload,verifyPairingProof} from '../src/pairing-proof.ts';
test('matches the fixed wire vector shared with the Waitron adapter',async()=>{
  const {readFile}=await import('node:fs/promises');
  const v=JSON.parse(await readFile(new URL('./pairing-vector.json',import.meta.url),'utf8'));
  assert.equal(pairingPayload(v.claims).toString('base64url'),v.payload);
  assert.deepEqual(verifyPairingProof(v.payload,v.signature,v.claims.origin,v.claims.action,v.claims.issuedAt),v.claims);
});
