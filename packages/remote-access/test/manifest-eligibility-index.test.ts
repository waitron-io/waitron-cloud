import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {afterEach,beforeEach,test} from 'node:test';
import type {Pool,PoolClient} from 'pg';
import {OrganisationPlanStore,RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import type {GatewayManifest,GatewayRoute} from '../src/manifest.ts';

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
async function measuredExport(cellId:string,mode:'existing'|'test-free-paid',publish=false){
 const connect=db.pool.connect.bind(db.pool);let lists=0,idReads=0,eligibleCount=0,arrayScans=0;
 const measuredIds=new Set<string>(),includes=Array.prototype.includes,indexOf=Array.prototype.indexOf;
 const measured={async connect(){
  const client=await connect(),query=client.query,release=client.release;
  client.query=async function(this:PoolClient,...args:unknown[]){
   const result=await Reflect.apply(query,this,args);
   if(typeof args[0]==='string'&&/SELECT\s+i\.id\s+FROM\s+installations\s+i\s+JOIN\s+venues\s+v\b/.test(args[0])){
    const map=result.rows.map;
    result.rows.map=function(...mapArgs:unknown[]){
     const ids=Reflect.apply(map,this,mapArgs) as string[];lists++;eligibleCount+=ids.length;
     for(const id of ids)measuredIds.add(id);
     // Observe reads without replacing the real database's IDs or lookup behavior.
     return new Proxy(ids,{get(target,key,receiver){
      if(typeof key==='string'&&/^\d+$/.test(key))idReads++;
      return Reflect.get(target,key,receiver);
     }});
    };
   }
   return result;
  } as PoolClient['query'];
  client.release=function(...args:Parameters<PoolClient['release']>){client.query=query;client.release=release;return Reflect.apply(release,client,args);};
  return client;
 }} as Pool;
 // Observe includes/indexOf on copies too; the ID-read proxy only observes its own list.
 Array.prototype.includes=function(this:unknown[],value:unknown,fromIndex?:number){
  if(typeof value==='string'&&measuredIds.has(value))arrayScans++;
  return includes.call(this,value,fromIndex);
 };
 Array.prototype.indexOf=function(this:unknown[],value:unknown,fromIndex?:number){
  if(typeof value==='string'&&measuredIds.has(value))arrayScans++;
  return indexOf.call(this,value,fromIndex);
 };
 let manifest:GatewayManifest|undefined;
 try{
  const exporting=new RemoteAccessStore(measured,mode);
  if(publish)await exporting.publishManifest(cellId,async value=>{manifest=value;},1234567890000);
  else manifest=await exporting.manifest(cellId,1234567890000);
 }
 finally{Array.prototype.includes=includes;Array.prototype.indexOf=indexOf;}
 assert(manifest);return {manifest,lists,idReads,eligibleCount,arrayScans};
}

// Reintroducing per-route array searches must fail the resource checks below.
function expectedRoute(value:GatewayRoute):GatewayRoute{
 return {installationId:value.installationId,venueId:value.venueId,staffHostname:value.staffHostname,publicHostname:value.publicHostname,address:value.address,port:value.port,peerPublicKey:value.peerPublicKey};
}
for(const publish of [false,true])for(const count of [4,16])test(`${publish?'published':'returned'} export indexes eligibility for ${count} active and incoming routes`,async t=>{
 const target=await cell(),source=await cell(),expected:GatewayRoute[]=[];
 for(let i=0;i<count;i++){
  const resident=await venue(i%2?source:target);
  if(i%2){const moved=await store.stageMove({operationId:randomUUID(),installationId:resident.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:1});expected.push(expectedRoute(moved.target));}
  else expected.push(expectedRoute((await db.pool.query('SELECT configuration FROM installation_services WHERE installation_id=$1 AND service=\'remote_access\'',[resident.installationId])).rows[0].configuration));
 }
 const measured=await measuredExport(target,'test-free-paid',publish);
 expected.sort((a,b)=>a.venueId.localeCompare(b.venueId));
 assert.deepEqual(measured.manifest,{version:1,audience:'waitron-cloud-gateway',cellId:target,sequence:1,issuedAt:1234567890000,expiresAt:1234568490000,routes:expected});
 assert.equal(measured.lists,1,'must observe the real eligibility result');assert.equal(measured.eligibleCount,count);
 t.diagnostic(`${count} eligible installations: ${measured.idReads} ID reads, ${measured.arrayScans} includes/indexOf calls`);
 assert(measured.idReads>0,'must observe membership processing');
 assert(measured.idReads<=count*2,`eligible IDs read ${measured.idReads} times for ${count} routes`);
 assert.equal(measured.arrayScans,0,'membership must not call includes/indexOf per route, including on a copy');
});

for(const publish of [false,true])test(`${publish?'published':'returned'} export keeps empty eligibility distinct from ordinary mode`,async()=>{
 const target=await cell(),source=await cell(),resident=await venue(target),incoming=await venue(source);
 const plans=new OrganisationPlanStore(db.pool);await plans.set(resident.organisationId,'free');await plans.set(incoming.organisationId,'free');
 const revision=(await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[incoming.installationId])).rows[0].configuration_revision;
 await store.stageMove({operationId:randomUUID(),installationId:incoming.installationId,targetCellId:target,targetPeerPublicKey:peer(),expectedRevision:revision});
 const empty=await measuredExport(target,'test-free-paid',publish);
 assert.deepEqual(empty.manifest.routes,[]);assert.equal(empty.lists,1);assert.equal(empty.eligibleCount,0);assert.equal(empty.idReads,0);
 const ordinary=await measuredExport(target,'existing',publish);
 assert.deepEqual(ordinary.manifest.routes.map(r=>r.installationId).sort(),[resident.installationId,incoming.installationId].sort());
 assert.equal(ordinary.lists,0);assert.equal(ordinary.idReads,0);
});
