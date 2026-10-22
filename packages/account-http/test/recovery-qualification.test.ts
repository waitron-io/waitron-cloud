import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createLeaseIssuer,transaction,OrganisationPlanStore} from '@waitron-cloud/registration';
import {database} from './fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {machineTarget,otherTarget,recoveryFixture,origin} from '../../backups/test/fixtures/recovery-v2.ts';
import {setVerificationPolicy} from '../../backups/src/verification-admission.ts';
import {fixtureImage,verificationOutput,verifyPointFixture} from '../../backups/test/fixtures/verification.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
let ip=0;
for(const fault of ['release','policy','unavailable','invalid','new-success','deleting','downgrade','expiry'] as const)test(`grant wait rechecks ${fault} before returning any archive credentials`,async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 const plans=new OrganisationPlanStore(db.pool);await plans.set(f.owner.organisationId,'paid');
 let grants=0,reached!:()=>void,release!:()=>void;const issuing=new Promise<void>(r=>reached=r),continueGrant=new Promise<void>(r=>release=r);
 const app=createAccountApp({planMode:'test-free-paid',pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{planMode:'test-free-paid',vault:f.vault,objects:()=>f.store,async grant(){grants++;reached();await continueGrant;return {credentials:{accessKeyId:'access',secretAccessKey:'secret',sessionToken:'temporary'},expiresAt:new Date(Date.now()+900000).toISOString()};}}});
 const pending=app.request(origin+'/api/recovery/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(t.envelope('read',f.point.digest))},{incoming:{socket:{remoteAddress:'192.0.2.'+(++ip)}}});
 try{
  await issuing;
  if(fault==='release')await db.secondPool.query('UPDATE backup_verification_policy SET release_ready=false');
  if(fault==='policy')await transaction(db.secondPool,c=>setVerificationPolicy(c,otherTarget(),fixtureImage,true));
  if(fault==='unavailable')await verifyPointFixture(db.secondPool,f.catalogue,f.point.id,async()=>{throw Error('no storage');});
  if(fault==='invalid')await verifyPointFixture(db.secondPool,f.catalogue,f.point.id,async(_s,_k,r)=>verificationOutput(r,'invalid','archive_invalid'));
  if(fault==='new-success')await verifyPointFixture(db.secondPool,f.catalogue,f.point.id);
  if(fault==='deleting')await db.secondPool.query('UPDATE backup_points SET deleting=true WHERE id=$1',[f.point.id]);
  if(fault==='downgrade')await new OrganisationPlanStore(db.secondPool).set(f.owner.organisationId,'free');
  if(fault==='expiry')await db.secondPool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[t.id]);
 }finally{release();}
 const response=await pending;assert.equal(grants,1);assert.equal(response.status,fault==='downgrade'?403:fault==='expiry'||fault==='deleting'?410:400);
 const body=await response.json();assert(!JSON.stringify(body).includes(f.capture.keys.recoveryKey));assert(!('credentials' in body));assert(!('point' in body));assert(!('verification' in body));
 assert.equal((await db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[f.installed.installationId])).rows[0].revoked_at,null);
});

for(const fault of ['release','policy','new-success','invalid'] as const)test(`already unqualified ${fault} refuses before any provider grant`,async()=>{
 const f=await recoveryFixture(db),t=machineTarget();await f.requests.machine('start',t.envelope('start'));await f.requests.approve(t.id,t.code,f.session.token,f.session.csrfToken,f.input);
 if(fault==='release')await db.pool.query('UPDATE backup_verification_policy SET release_ready=false');
 if(fault==='policy')await transaction(db.pool,c=>setVerificationPolicy(c,otherTarget(),fixtureImage,true));
 if(fault==='new-success')await verifyPointFixture(db.pool,f.catalogue,f.point.id);
 if(fault==='invalid')await verifyPointFixture(db.pool,f.catalogue,f.point.id,async(_s,_k,r)=>verificationOutput(r,'invalid','archive_invalid'));
 let grants=0;
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>f.store,async grant(){grants++;return {credentials:{accessKeyId:'access',secretAccessKey:'secret',sessionToken:'temporary'},expiresAt:new Date(Date.now()+900000).toISOString()};}}});
 const response=await app.request(origin+'/api/recovery/read',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(t.envelope('read',f.point.digest))},{incoming:{socket:{remoteAddress:'192.0.2.'+(++ip)}}});
 assert.equal(response.status,400);assert.deepEqual(await response.json(),{error:'unverified'});assert.equal(grants,0);
});
