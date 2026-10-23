import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {verifyLease,type SignedEnvelope} from '@waitron-cloud/registration';
import {staffExchangeFixture} from '../../remote-access/test/staff-exchange-fixture.ts';
let f:Awaited<ReturnType<typeof staffExchangeFixture>>;
before(async()=>{f=await staffExchangeFixture();});after(async()=>f?.close());
const submit='staff-certificate-submit',status='staff-certificate-status';
test('signed CSR exchange survives a lost reply and binds a bounded current request to its installation',async()=>{
 const a=await f.venue(),id=randomUUID(),envelope=a.proof(submit,a.body,id,a.lease);
 const first=await f.request(submit,envelope);assert.equal(first.status,200,await first.clone().text());const accepted=await first.json();
 assert.equal(first.headers.get('cache-control'),'no-store');assert.equal(accepted.requestId,id);assert.equal(accepted.installationId,a.installationId);assert.equal(accepted.state,'pending');assert.equal(accepted.version,1);
 assert.deepEqual(await(await f.request(submit,envelope)).json(),accepted);
 assert.deepEqual(await(await f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),a.lease))).json(),accepted);
 assert.equal((await f.db.pool.query('SELECT count(*)::integer AS n FROM staff_certificate_exchange WHERE installation_id=$1',[a.installationId])).rows[0].n,1);
});
test('forgery, browser origin, wrong action, missing lease, tenant crossing and extra authority fields are refused',async()=>{
 const a=await f.venue(),b=await f.venue(),id=randomUUID();
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease),{origin:f.origin})).status,403);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease,b.installationId))).status,401);
 assert.equal((await f.request(submit,a.proof(status,a.body,id,a.lease))).status,401);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id))).status,401);
 assert.equal((await f.request(submit,a.proof(submit,{...a.body,dnsModule:'/attacker'},id,a.lease))).status,400);
 assert.equal((await f.request(submit,a.proof(submit,{...a.body,hostname:b.body.hostname},id,a.lease))).status,409);
 assert.equal((await f.request(submit,a.proof(submit,{...a.body,csr:b.body.csr},id,a.lease))).status,400);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,b.lease))).status,401);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,200);
 assert.equal((await f.request(status,b.proof(status,{version:1,requestId:id},randomUUID(),b.lease))).status,409);
});
test('replacement requires the current predecessor and a stale retry cannot restore an older CSR',async()=>{
 const a=await f.venue(),id=randomUUID();assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,200);
 const changed={...a.body,previousRequestId:id},next=randomUUID();
 assert.equal((await f.request(submit,a.proof(submit,a.body,next,a.lease))).status,409);
 assert.equal((await f.request(submit,a.proof(submit,changed,id,a.lease))).status,409);
 assert.equal((await f.request(submit,a.proof(submit,changed,next,a.lease))).status,200);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,409);
 assert.equal((await f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),a.lease))).status,409);
 assert.equal((await f.db.pool.query('SELECT request_id FROM staff_certificate_exchange WHERE installation_id=$1',[a.installationId])).rows[0].request_id,next);
});
test('current revision, live lease and revocation are checked again on reads and retries',async(t)=>{
 const a=await f.venue(),id=randomUUID();assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,200);
 const claims=JSON.parse(Buffer.from(a.lease.payload,'base64url').toString());
 // Advance only synchronous lease construction; the request must use the real clock.
 const now=Date.now();let tick=now;
 const clock=t.mock.method(Date,'now',()=>{const value=tick;tick+=2;return value;});let expired:SignedEnvelope;
 try{const issuedAt=Date.now()-3600000;expired=f.issuer.issue({origin:f.origin,leaseId:claims[3],installationId:a.installationId,venueId:a.venueId,environment:'test',publicKey:claims[7],issuedAt,expiresAt:issuedAt+3599999});}finally{clock.mock.restore();}
 assert.equal((await f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),expired))).status,401);
 await f.db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[a.installationId]);
 assert.equal((await f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),a.lease))).status,409);
 assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,409);
 await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[a.installationId]);
 assert.equal((await f.request(status,a.proof(status,{version:1,requestId:id},randomUUID(),a.lease))).status,403);
});

test('simultaneous replacements serialize on their predecessor and stale issued proofs cannot create work',async()=>{
 const a=await f.venue(),id=randomUUID();assert.equal((await f.request(submit,a.proof(submit,a.body,id,a.lease))).status,200);
 const replies=await Promise.all([randomUUID(),randomUUID()].map(next=>f.request(submit,a.proof(submit,{...a.body,previousRequestId:id},next,a.lease))));assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
 const proof=a.proof(status,{version:1,requestId:id},randomUUID(),a.lease),values=JSON.parse(Buffer.from(proof.payload,'base64url').toString());values[5]-=120000;
 assert.equal((await f.request(status,{...proof,payload:Buffer.from(JSON.stringify(values)).toString('base64url')})).status,401);
});

test('exchange is disabled unless the account service explicitly enables it',async()=>{
 const disabled=await staffExchangeFixture(false);
 try{const a=await disabled.venue();assert.equal((await disabled.request(submit,a.proof(submit,a.body,randomUUID(),a.lease))).status,503);assert.equal((await disabled.db.pool.query('SELECT count(*)::integer AS n FROM staff_certificate_exchange')).rows[0].n,0);}finally{await disabled.close();}
});
test('local exchange refuses a production installation even with its matching live lease',async(t)=>{
 const a=await f.venue();await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[a.venueId]);const c=JSON.parse(Buffer.from(a.lease.payload,'base64url').toString());
 // Advance only lease construction; restore before using the lease.
 const now=Date.now();let tick=now;
 const clock=t.mock.method(Date,'now',()=>tick++);let lease:SignedEnvelope;
 try{const issuedAt=Date.now();lease=f.issuer.issue({origin:f.origin,leaseId:c[3],installationId:a.installationId,venueId:a.venueId,environment:'production',publicKey:c[7],issuedAt,expiresAt:issuedAt+3600000});}finally{clock.mock.restore();}
 const claims=verifyLease(lease,new Map([[f.issuer.keyId,f.issuer.publicKey]]),f.origin,now);
 assert.equal(claims.expiresAt-claims.issuedAt,3600000);
 assert.equal((await f.request(submit,a.proof(submit,a.body,randomUUID(),lease))).status,403);
});
