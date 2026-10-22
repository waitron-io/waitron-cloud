import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {database} from './fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {machineTarget,otherTarget,recoveryFixture,origin} from '../../backups/test/fixtures/recovery-v2.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
let fixtureNumber=0;
async function fixture(){
 const f=await recoveryFixture(db);let grants=0,credentialBytes=6;
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]},leaseIssuer:createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),captures:{vault:f.vault,objects:()=>f.store,async grant(){grants++;return {credentials:{accessKeyId:'access',secretAccessKey:'s'.repeat(credentialBytes),sessionToken:'temporary'},expiresAt:new Date(Date.now()+900000).toISOString()};}}});
 const bindings={incoming:{socket:{remoteAddress:'192.0.2.'+(++fixtureNumber)}}};
 const post=(action:string,body:unknown,owner=false)=>app.request(origin+(owner?'/api/account/recovery/':'/api/recovery/')+action,{method:'POST',headers:{'content-type':'application/json',...(owner?{origin,cookie:'__Host-cloud_session='+f.session.token,'x-csrf-token':f.session.csrfToken}:{})},body:typeof body==='string'?body:JSON.stringify(body)},bindings);
 return {...f,post,app,bindings,grants:()=>grants,setCredentialBytes:(bytes:number)=>{credentialBytes=bytes;}};
}
test('machine HTTP negotiates v2 and returns the same approved verification on metadata and download',async()=>{
 const f=await fixture(),t=machineTarget();
 const start=await f.post('start',t.envelope('start'));assert.equal(start.status,200);assert.equal((await start.json()).version,2);
 const owner=await f.post('approve',{requestId:t.id,code:t.code,pointId:f.point.id,oldServerUnavailable:'true',acceptDataLoss:'true'},true);assert.equal(owner.status,200);assert(!JSON.stringify(await owner.json()).includes('recoveryKey'));
 const info=await f.post('info',t.envelope('info'));assert.equal(info.status,200);const metadata=await info.json();assert.equal(metadata.version,2);assert.deepEqual(metadata.verification.target,t.target);assert(!('keys' in metadata));assert(!('recoveryKey' in metadata));
 const read=await f.post('read',t.envelope('read',f.point.digest));assert.equal(read.status,200);const grant=await read.json();assert.equal(grant.version,2);assert.deepEqual(grant.verification,metadata.verification);assert.equal(grant.recoveryKey,f.capture.keys.recoveryKey);assert(!JSON.stringify(grant).includes(f.capture.keys.streamKey));assert.equal(f.grants(),1);
 const restored=await f.post('restored',t.envelope('restored',f.point.digest));assert.deepEqual(await restored.json(),{version:2,status:'restored'});
 const bad=await f.post('read',t.envelope('read',f.point.digest,Date.now(),origin,1));assert.equal(bad.status,401);assert.equal(f.grants(),1);
});
test('machine HTTP accepts a 32-owner target above the generic 16KiB body cap without widening owner forms',async()=>{
 const f=await fixture(),target=otherTarget();for(const m of target.modules){m.packageVersion='v'.repeat(256);}
 // Recompute a valid large descriptor independently of the HTTP reader.
 const {backupVerificationTargetDigests}=await import('../../backups/src/verification-protocol.ts');Object.assign(target,backupVerificationTargetDigests(target));
 const t=machineTarget(target),body=JSON.stringify(t.envelope('start'));assert(Buffer.byteLength(body)>16384);assert(Buffer.byteLength(JSON.stringify(target))<=30000);
 const response=await f.post('start',body);assert.equal(response.status,200);assert.equal((await response.json()).version,2);
 assert.equal((await f.post('inspect',JSON.stringify({requestId:t.id,code:t.code,extra:'x'.repeat(17000)}),true)).status,413);
});
for(const fault of ['duplicate-root','duplicate-nested','unknown','mixed','tamper','oversized-target','oversized-body','utf8','trailing','exponent'] as const)test(`machine HTTP refuses ${fault} before a request or grant exists`,async()=>{
 const f=await fixture(),t=machineTarget();let raw=JSON.stringify(t.envelope('start'));
 if(fault==='duplicate-root')raw=raw.replace('"version":2','"version":1,"vers\\u0069on":2');
 if(fault==='duplicate-nested')raw=raw.replace('"fingerprint":','"fingerprint":"'+'f'.repeat(64)+'","fingerpr\\u0069nt":');
 if(fault==='unknown')raw=raw.replace('{','{"extra":true,');
 if(fault==='mixed')raw=raw.replace('"version":2','"version":1');
 if(fault==='tamper')raw=raw.replace(t.target.digest,'0'.repeat(64));
 if(fault==='oversized-target'){const target=otherTarget(64);for(const m of target.modules)m.packageVersion='v'.repeat(256);const {backupVerificationTargetDigests}=await import('../../backups/src/verification-protocol.ts');Object.assign(target,backupVerificationTargetDigests(target));raw=JSON.stringify(machineTarget(target).envelope('start'));assert(Buffer.byteLength(JSON.stringify(target))>30000);assert(Buffer.byteLength(raw)<65536);}
 if(fault==='oversized-body')raw+=' '.repeat(65536);
 if(fault==='trailing')raw+='{}';
 if(fault==='exponent')raw=raw.replace('"version":2','"version":2e0');
 let response:Response;
 if(fault==='utf8'){const at=raw.indexOf('"payload":"')+11;response=await f.app.request(origin+'/api/recovery/start',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.concat([Buffer.from(raw.slice(0,at)),Buffer.from([0xff]),Buffer.from(raw.slice(at+1))])},f.bindings);}
 else response=await f.post('start',raw);
 assert.equal(response.status,fault==='oversized-body'?413:400);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_recovery_requests WHERE id=$1',[t.id])).rows[0].count,'0');assert.equal(f.grants(),0);
});

test('v2 refuses a provider grant that would exceed Waitron’s 65536-byte response budget',async()=>{
 const f=await fixture(),t=machineTarget();await f.post('start',t.envelope('start'));
 await f.post('approve',{requestId:t.id,code:t.code,pointId:f.point.id,oldServerUnavailable:'true',acceptDataLoss:'true'},true);
 f.setCredentialBytes(65536);const response=await f.post('read',t.envelope('read',f.point.digest));
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'temporarily_unavailable'});
});

test('machine reader bounds advertised and split streamed bytes before parsing',async()=>{
 const {readRecoveryMachineBody}=await import('../src/recovery-machine-body.ts');
 const body=JSON.stringify(machineTarget().envelope('start'));
 await assert.rejects(readRecoveryMachineBody(new Request(origin,{method:'POST',headers:{'content-type':'application/json','content-length':'65537'},body}),false),e=>e instanceof Error&&'status' in e&&e.status===413);
 let cancelled=false;
 const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(40000));controller.enqueue(new Uint8Array(40000));},cancel(){cancelled=true;}});
 await assert.rejects(readRecoveryMachineBody(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit),false),e=>e instanceof Error&&'status' in e&&e.status===413);assert(cancelled);
});
test('machine reader rejects aborted requests and cancels a stalled stream on abort',async()=>{
 const {readRecoveryMachineBody}=await import('../src/recovery-machine-body.ts');
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(readRecoveryMachineBody(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:aborted.signal}),false),e=>e instanceof Error&&'status' in e&&e.status===408);
 const controller=new AbortController();let cancelled=false,readStarted!:()=>void;const reading=new Promise<void>(resolve=>{readStarted=resolve;});
 const body=new ReadableStream<Uint8Array>({pull(){readStarted();},cancel(){cancelled=true;}});
 const pending=readRecoveryMachineBody(new Request(origin,{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal,duplex:'half'} as RequestInit),false);
 const refused=assert.rejects(pending,e=>e instanceof Error&&'status' in e&&e.status===408);await reading;controller.abort();await refused;assert(cancelled);
});
for(const fault of ['version','missing-id','start-id','payload-bound','signature-bound','content-type','encoding'] as const)test(`machine reader preserves ${fault} rejection`,async()=>{
 const {readRecoveryMachineBody}=await import('../src/recovery-machine-body.ts');
 const proof:Record<string,unknown>={...machineTarget().envelope('start')};
 if(fault==='version')proof.version=3;
 if(fault==='start-id')proof.id='11111111-1111-4111-8111-111111111111';
 if(fault==='payload-bound')proof.payload='a'.repeat(2049);
 if(fault==='signature-bound')proof.signature='a'.repeat(87);
 const headers={'content-type':fault==='content-type'?'text/plain':'application/json',...(fault==='encoding'?{'content-encoding':'gzip'}:{})};
 await assert.rejects(readRecoveryMachineBody(new Request(origin,{method:'POST',headers,body:JSON.stringify(proof)}),fault==='missing-id'),e=>e instanceof Error&&'status' in e&&e.status===(fault==='content-type'||fault==='encoding'?415:400));
});
