import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {OrganisationPlanStore,RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import type {GatewayRoute} from '../src/manifest.ts';

let db:Awaited<ReturnType<typeof database>>,store:RemoteAccessStore,subnet:number;
const peer=()=>randomBytes(32).toString('base64');
beforeEach(async()=>{db=await database();store=new RemoteAccessStore(db.pool);subnet=160;});
afterEach(async()=>db?.close());
async function cell(){
 const id=randomUUID();await store.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`batch-${id}.example.test`,subnet:subnet++,publicKey:peer(),endpoint:'gateway.example.test:51820'});return id;
}
async function venue(cellId:string){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(`batch-${randomUUID()}@example.test`);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
 const owner=await signup.complete(mail.token,{password:'A sufficiently long test password',organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});
 await new OrganisationPlanStore(db.pool).set(owner.organisationId,'paid');
 const registration=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());
 const installed=await registration.complete(binding);await store.provision(installed.installationId,cellId,peer());
 return {...owner,...installed};
}
async function measuredSchedule(){
 const connect=db.pool.connect.bind(db.pool);let routeReads=0;
 const measured={async connect(){
  const client=await connect(),query=client.query,release=client.release;
  client.query=function(this:PoolClient,...args:unknown[]){
   if(typeof args[0]==='string'&&/^SELECT\b/.test(args[0])&&/FROM remote_(placements|cell_moves) [pm]\b/.test(args[0]))routeReads++;
   return Reflect.apply(query,this,args);
  } as PoolClient['query'];
  client.release=function(...args:Parameters<PoolClient['release']>){client.query=query;client.release=release;return Reflect.apply(release,client,args);};
  return client;
 }} as Pool;
 // The real transaction and queries run on the fixture's client; only reads are counted.
 const measuredWorker=new RemoteConfigurationReconciler(measured);
 await measuredWorker.schedule();return routeReads;
}
function routeDigest(routes:GatewayRoute[]){
 return createHash('sha256').update(JSON.stringify([...routes].sort((a,b)=>a.venueId.localeCompare(b.venueId)).map(r=>({installationId:r.installationId,venueId:r.venueId,staffHostname:r.staffHostname,publicHostname:r.publicHostname,address:r.address,port:r.port,peerPublicKey:r.peerPublicKey})))).digest('hex');
}
async function assertRoutes(cellId:string,ids:string[],mode:'existing'|'test-free-paid'='existing'){
 const manifest=await new RemoteAccessStore(db.pool,mode).manifest(cellId);
 assert.deepEqual(manifest.routes.map(r=>r.installationId).sort(),[...ids].sort());
 const row=(await db.pool.query("SELECT desired_digest,enabled FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[cellId])).rows[0];
 assert.deepEqual(row,{desired_digest:routeDigest(manifest.routes),enabled:true});
}

test('route reads stay bounded as cells grow and keep empty-cell jobs',async t=>{
 const first=await cell();await venue(first);
 const small=await measuredSchedule();
 const cells=[first];for(let i=0;i<7;i++)cells.push(await cell());
 const large=await measuredSchedule();
 await assertRoutes(first,(await store.manifest(first)).routes.map(r=>r.installationId));
 for(const id of cells.slice(1))await assertRoutes(id,[]);
 t.diagnostic(`real PostgreSQL route reads: 1 cell=${small}; 8 cells=${large}`);
 assert.ok(large<=2,`8 cells need at most two route reads, observed ${large}`);
});

for(const mode of ['existing','test-free-paid'] as const)test(`batched ${mode} targets keep active and incoming routes in their own cells`,async()=>{
 const source=await cell(),target=await cell(),empty=await cell();
 const moving=await venue(source),neighbour=await venue(source),resident=await venue(target);
 const move=await store.stageMove({operationId:randomUUID(),installationId:moving.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});
 const worker=new RemoteConfigurationReconciler(db.pool,{planMode:mode});await worker.schedule();
 await assertRoutes(source,[moving.installationId,neighbour.installationId],mode);
 await assertRoutes(target,[moving.installationId,resident.installationId],mode);await assertRoutes(empty,[],mode);
 const before=(await db.pool.query('SELECT kind,target_id,desired_digest FROM remote_configuration_jobs ORDER BY kind,target_id')).rows;
 assert.equal(before.length,9);assert.equal(await worker.schedule(),0);
 assert.deepEqual((await db.pool.query('SELECT kind,target_id,desired_digest FROM remote_configuration_jobs ORDER BY kind,target_id')).rows,before);
 await store.markMoveReady(move.operationId,1,(await store.manifest(target)).sequence);await worker.schedule();
 await assertRoutes(target,[moving.installationId,resident.installationId],mode);
 await store.cancelMove(move.operationId,1);await worker.schedule();await assertRoutes(target,[resident.installationId],mode);
});

for(const change of ['revision','revocation'] as const)test(`batched incoming routes exclude ${change} changes`,async()=>{
 const source=await cell(),target=await cell(),moving=await venue(source),resident=await venue(target);
 await store.stageMove({operationId:randomUUID(),installationId:moving.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});
 await db.pool.query(change==='revision'?'UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1':'UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[moving.installationId]);
 await new RemoteConfigurationReconciler(db.pool).schedule();
 await assertRoutes(source,change==='revision'?[moving.installationId]:[]);await assertRoutes(target,[resident.installationId]);
 const certificates=(await db.pool.query("SELECT count(*)::integer AS n FROM remote_configuration_jobs WHERE kind<>'route' AND target_id=$1 AND enabled",[moving.installationId])).rows[0].n;
 assert.equal(certificates,change==='revision'?2:0);
});

for(const change of ['free','production','unconfigured'] as const)test(`batched test-mode targets exclude ${change} active and incoming routes`,async()=>{
 const source=await cell(),target=await cell(),moving=await venue(source),resident=await venue(target);
 await store.stageMove({operationId:randomUUID(),installationId:moving.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});
 if(change==='free')await new OrganisationPlanStore(db.pool).set(moving.organisationId,'free');
 else if(change==='production')await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[moving.venueId]);
 else await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='remote_access'",[moving.installationId]);
 await new RemoteConfigurationReconciler(db.pool,{planMode:'test-free-paid'}).schedule();
 await assertRoutes(source,[],'test-free-paid');await assertRoutes(target,[resident.installationId],'test-free-paid');
 assert.equal((await db.pool.query("SELECT count(*)::integer AS n FROM remote_configuration_jobs WHERE kind<>'route' AND target_id=$1 AND enabled",[moving.installationId])).rows[0].n,0);
});
