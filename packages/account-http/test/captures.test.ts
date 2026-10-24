import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore,RegistrationStore,InstallationStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {BackupKeyVault} from '../../backups/src/keys.ts';
import {BackupCatalogue} from '../../backups/src/catalogue.ts';
import {receipt,type StorageLocation,type StorageScope} from '../../backups/src/storage.ts';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',key=generateKeyPairSync('ed25519');
const secondKey=generateKeyPairSync('ed25519');
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const vault=new BackupKeyVault(randomBytes(32));
let db:Awaited<ReturnType<typeof database>>,id:string,otherId:string,lease:SignedEnvelope,catalogue:BackupCatalogue,app:ReturnType<typeof createAccountApp>;
let grantHook:()=>Promise<void>,putHook:()=>Promise<void>;
const data=new Map<string,Buffer>(),grants:{location:StorageLocation;scope:StorageScope}[]=[];
const objects=(l:StorageLocation)=>({async read(k:string){const b=data.get(l.bucket+'/'+k);if(!b)throw Error('NoSuchKey');return b;},async put(k:string,b:Uint8Array){await putHook();data.set(l.bucket+'/'+k,Buffer.from(b));return receipt(b);},async remove(k:string){data.delete(l.bucket+'/'+k);}});
const config=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]});
const captureOptions={vault,objects,async grant(location:StorageLocation,scope:StorageScope){grants.push({location,scope});await grantHook();return {credentials:{accessKeyId:'scoped-id',secretAccessKey:'scoped-secret',sessionToken:'scoped-token'},expiresAt:new Date(Date.now()+900000).toISOString()};}};
function resetApp(){app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:issuer,captures:captureOptions} as Parameters<typeof createAccountApp>[0]);}
function proof(action:string,captureId= randomUUID(),body:unknown={},target=id,currentLease=lease,issuedAt=Date.now()){
 const bytes=encodeMachine({origin,action:action as MachineAction,installationId:target,operationId:captureId,issuedAt,lease:JSON.stringify(currentLease),body:JSON.stringify(body)});
 return {payload:bytes.toString('base64url'),signature:sign(null,bytes,(target===otherId?secondKey:key).privateKey).toString('base64url')};
}
function request(action:string,envelope:unknown,headers:Record<string,string>={}){return app.request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(envelope)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings);}
async function renew(target=id){const bytes=encodeMachine({origin,action:'renew',installationId:target,operationId:randomUUID(),issuedAt:Date.now(),lease:'',body:'{}'});return (await new InstallationStore(db.pool,issuer,origin).execute('renew',{payload:bytes.toString('base64url'),signature:sign(null,bytes,(target===otherId?secondKey:key).privateKey).toString('base64url')})).lease!;}
function metadata(bytes:Buffer){return {...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}};}
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
 await resetSchema(db.pool);data.clear();grants.length=0;grantHook=async()=>{};putHook=async()=>{};
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('capture@example.test');const m=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in m);
 const owner=await signup.complete(m.token,{password:'A long enough test password',organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const r=new RegistrationStore(db.pool);const ids=[];
 for(let n=0;n<2;n++){const b={operationId:randomUUID(),installationKey:(n===0?key:secondKey).publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());ids.push((await r.complete(b)).installationId);}
 [id,otherId]=ids as [string,string];catalogue=new BackupCatalogue(db.pool,vault,objects);
 await catalogue.provision(id,{endpoint:'https://store.test',bucket:'venue-one',region:'local'});await catalogue.provision(otherId,{endpoint:'https://store.test',bucket:'venue-two',region:'local'});lease=await renew();resetApp();
});
test('authenticated reserve renews one capture key; publish is immutable, pending verification and secret-free in history',async()=>{
 const capture=randomUUID(),first=await request('backup-reserve',proof('backup-reserve',capture));assert.equal(first.status,200,await first.clone().text());assert.equal(first.headers.get('cache-control'),'no-store');
 const grant=await first.json();assert.equal(grant.id,capture);assert.equal(grant.installationId,id);assert.equal(grant.incomingKey,'incoming/'+capture);assert.match(grant.recoveryKey,/^[A-Za-z0-9_-]{43}$/);assert(!('streamKey' in grant));assert(!('keys' in grant));
 assert.deepEqual(grants[0],{location:{endpoint:'https://store.test',bucket:'venue-one',region:'local'},scope:{kind:'capture',bucket:'venue-one',scope:'incoming/'+capture}});
 await catalogue.rotate(id);resetApp();const retried=await(await request('backup-reserve',proof('backup-reserve',capture))).json();assert.equal(retried.recoveryKey,grant.recoveryKey);assert.equal(retried.keyVersion,1);
 const bytes=Buffer.from('encrypted snapshot'),m=metadata(bytes);data.set('venue-one/'+grant.incomingKey,bytes);
 const published=await request('backup-publish',proof('backup-publish',capture,m));assert.equal(published.status,200,await published.clone().text());const point=await published.json();assert.equal(point.id,capture);assert.equal(point.verification,'pending');assert(!('objectKey' in point));
 resetApp();assert.deepEqual(await(await request('backup-publish',proof('backup-publish',capture,m))).json(),point);
 assert.equal((await request('backup-publish',proof('backup-publish',capture,{...m,size:1}))).status,409);
 const history=JSON.stringify((await db.pool.query('SELECT * FROM installation_operations')).rows);for(const secret of [grant.recoveryKey,'scoped-secret','scoped-token'])assert(!history.includes(secret));
});
test('capture authority accepts an old live lease only while its issuer remains in the rotation overlap',async()=>{
 const next=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const trusted=new Map([[issuer.keyId,issuer.publicKey],[next.keyId,next.publicKey]]);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:next,leaseTrust:trusted,captures:captureOptions});
 const capture=randomUUID();assert.equal((await request('backup-reserve',proof('backup-reserve',capture))).status,200);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:next,captures:captureOptions});
 assert.equal((await request('backup-reserve',proof('backup-reserve',randomUUID()))).status,401);
});
test('refuses browser origin, forged/wrong action, expired lease, cross-venue capture and arbitrary reserve body',async(t)=>{
 const capture=randomUUID();assert.equal((await request('backup-reserve',proof('backup-reserve',capture),{origin})).status,403);
 assert.equal((await request('backup-reserve',{...proof('backup-reserve'),signature:'a'.repeat(86)})).status,401);
 assert.equal((await request('backup-reserve',proof('backup-publish'))).status,401);
 assert.equal((await request('backup-reserve',proof('backup-reserve',capture,{bucket:'attacker'}))).status,400);
 assert.equal((await request('backup-reserve',proof('backup-reserve',capture))).status,200);
 const second=await renew(otherId);assert.equal((await request('backup-reserve',proof('backup-reserve',capture,{},otherId,second))).status,409);
 const values=JSON.parse(Buffer.from(lease.payload,'base64url').toString());
 // Advance only synchronous lease construction; the request must use the real clock.
 const now=Date.now();let tick=now;
 const clock=t.mock.method(Date,'now',()=>{const value=tick;tick+=2;return value;});let old:SignedEnvelope;
 try{const issuedAt=Date.now()-3600000;old=issuer.issue({origin,leaseId:values[3],installationId:id,venueId:values[5],environment:'test',publicKey:values[7],issuedAt,expiresAt:issuedAt+3599999});}finally{clock.mock.restore();}
 assert.equal((await request('backup-reserve',proof('backup-reserve',randomUUID(),{},id,old))).status,401);
});
test('revocation committed during provider request prevents credentials returning',async()=>{
 grantHook=async()=>{await db.secondPool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[id]);};
 const response=await request('backup-reserve',proof('backup-reserve'));assert.equal(response.status,403);assert(!JSON.stringify(await response.json()).includes('scoped-secret'));
});
test('disabled service, production environment and expired captures refuse new grants',async()=>{
 const capture=randomUUID();assert.equal((await request('backup-reserve',proof('backup-reserve',capture))).status,200);
 await db.pool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '24 hours' WHERE id=$1",[capture]);
 assert.equal((await request('backup-reserve',proof('backup-reserve',capture))).status,410);
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='retained_snapshots'",[id]);assert.equal((await request('backup-reserve',proof('backup-reserve'))).status,403);
 await db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='retained_snapshots'",[id]);await db.pool.query("UPDATE venues SET environment='production' WHERE id=(SELECT venue_id FROM installations WHERE id=$1)",[id]);assert.equal((await request('backup-reserve',proof('backup-reserve'))).status,403);
});
test('lease expires during object write: publication does not commit',async()=>{
 const capture=randomUUID();await request('backup-reserve',proof('backup-reserve',capture));const bytes=Buffer.from('archive');data.set('venue-one/incoming/'+capture,bytes);
 const values=JSON.parse(Buffer.from(lease.payload,'base64url').toString());const now=Date.now(),brief=issuer.issue({origin,leaseId:randomUUID(),installationId:id,venueId:values[5],environment:'test',publicKey:values[7],issuedAt:now,expiresAt:now+100});
 putHook=async()=>{await new Promise(r=>setTimeout(r,150));};const response=await request('backup-publish',proof('backup-publish',capture,metadata(bytes),id,brief));assert.equal(response.status,401);assert.equal((await db.pool.query('SELECT count(*) FROM backup_points')).rows[0].count,'0');
});
for(const change of ['disable','expire'] as const)test('provider wait rechecks '+change+' before returning a grant',async()=>{
 grantHook=async()=>{if(change==='disable')await db.secondPool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='retained_snapshots'",[id]);else await db.secondPool.query("UPDATE backup_captures SET created_at=clock_timestamp()-interval '24 hours'");};
 assert.equal((await request('backup-reserve',proof('backup-reserve'))).status,change==='disable'?403:410);
});
test('a lease that expires while waiting for the installation lock cannot reserve a capture',async()=>{
 const values=JSON.parse(Buffer.from(lease.payload,'base64url').toString()),capture=randomUUID();
 const now=Date.now(),brief=issuer.issue({origin,leaseId:randomUUID(),installationId:id,venueId:values[5],environment:'test',publicKey:values[7],issuedAt:now,expiresAt:now+250});
 const blocker=await db.secondPool.connect();await blocker.query('BEGIN');await blocker.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[id]);
 const response=request('backup-reserve',proof('backup-reserve',capture,{},id,brief));
 try{let blocked=false;for(let i=0;i<100;i++){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema])).rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}assert(blocked);await new Promise(r=>setTimeout(r,300));}finally{await blocker.query('ROLLBACK');blocker.release();}
 assert.equal((await response).status,401);assert.equal((await db.pool.query('SELECT count(*) FROM backup_captures')).rows[0].count,'0');assert.equal(grants.length,0);
});
test('publish refuses wrong bytes and another installation; missing runtime stays disabled',async()=>{
 const capture=randomUUID();await request('backup-reserve',proof('backup-reserve',capture));data.set('venue-one/incoming/'+capture,Buffer.from('actual'));
 const m=metadata(Buffer.from('wrong'));assert.equal((await request('backup-publish',proof('backup-publish',capture,m))).status,409);
 const second=await renew(otherId);assert.equal((await request('backup-publish',proof('backup-publish',capture,m,otherId,second))).status,503);
 assert.equal((await db.pool.query('SELECT count(*) FROM backup_points')).rows[0].count,'0');
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),leaseIssuer:issuer});assert.equal((await request('backup-reserve',proof('backup-reserve'))).status,503);
});
test('configured captures require an issuer at app creation',()=>{
 assert.throws(()=>createAccountApp({pool:db.pool,outbox:db.outbox,config:config(),captures:captureOptions}),/^Error: backup.installation_issuer_required$/);
});
test('direct lifecycle execution refuses capture actions before operation history is written',async()=>{
 const store=new InstallationStore(db.pool,issuer,origin),before=(await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count;
 for(const action of ['backup-reserve','backup-publish'] as const)await assert.rejects(store.execute(action,proof(action)),/^Error: invalid_proof$/);
 assert.equal((await db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,before);
});
