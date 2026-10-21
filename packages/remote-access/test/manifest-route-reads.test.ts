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
beforeEach(async()=>{db=await database();store=new RemoteAccessStore(db.pool);subnet=170;});
afterEach(async()=>db?.close());
async function cell(){
 const id=randomUUID(),network=subnet++;
 await store.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`reads-${id}.example.test`,subnet:network,publicKey:peer(),endpoint:'gateway.example.test:51820'});
 return {id,network};
}
async function owner(){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(`reads-${randomUUID()}@example.test`);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token' in mail);
 const result=await signup.complete(mail.token,{password:'A sufficiently long test password',organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});
 await new OrganisationPlanStore(db.pool).set(result.organisationId,'paid');return result;
}
async function venue(account:Awaited<ReturnType<typeof owner>>,home:Awaited<ReturnType<typeof cell>>,port=443){
 const registration=new RegistrationStore(db.pool),binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:account.organisationId,legalBusinessId:account.legalBusinessId};
 await registration.start(binding);await registration.approveCloud(binding,account.accountId);await registration.approveLocal(binding,randomUUID());
 const installed=await registration.complete(binding),key=peer();await store.provision(installed.installationId,home.id,key,port);
 return {...installed,key};
}
async function measuredExport(cellId:string,mode:'existing'|'test-free-paid',publish:boolean){
 const connect=db.pool.connect.bind(db.pool);let statements=0;
 const measured={async connect(){
  const client=await connect(),query=client.query,release=client.release;
  // Count every actual database call, including any newly introduced per-route read.
  client.query=function(this:PoolClient,...args:unknown[]){statements++;return Reflect.apply(query,this,args);} as PoolClient['query'];
  client.release=function(...args:Parameters<PoolClient['release']>){client.query=query;client.release=release;return Reflect.apply(release,client,args);};
  return client;
 }} as Pool;
 let manifest:GatewayManifest|undefined;const exporting=new RemoteAccessStore(measured,mode);
 if(publish)await exporting.publishManifest(cellId,async value=>{manifest=value;},1234567890000);
 else manifest=await exporting.manifest(cellId,1234567890000);
 assert(manifest);return {manifest,statements};
}

// Restoring either per-route detail lookup must exceed the database-call budget.
for(const publish of [false,true])for(const mode of ['existing','test-free-paid'] as const)for(const count of [4,16])test(`${publish?'published':'returned'} ${mode} export uses fixed database calls for ${count} mixed routes`,async t=>{
 const target=await cell(),source=await cell(),account=await owner(),expected:GatewayRoute[]=[];
 for(let i=0;i<count;i++){
  const home=i%2?source:target,resident=await venue(account,home,8443+i);
  const address=`10.77.${target.network}.${2+i}`;let key=resident.key,port=8443+i;
  if(i%2){
   key=peer();port=9443+i;
   await store.stageMove({operationId:randomUUID(),installationId:resident.installationId,targetCellId:target.id,targetPeerPublicKey:key,port,expectedRevision:1});
  }
  expected.push({installationId:resident.installationId,venueId:resident.venueId,staffHostname:`staff-v-${resident.venueId}.reads-${home.id}.example.test`,publicHostname:`v-${resident.venueId}.reads-${home.id}.example.test`,address,port,peerPublicKey:key});
 }
 await venue(account,source);
 const measured=await measuredExport(target.id,mode,publish);
 expected.sort((a,b)=>a.venueId.localeCompare(b.venueId));
 assert.deepEqual(measured.manifest,{version:1,audience:'waitron-cloud-gateway',cellId:target.id,sequence:1,issuedAt:1234567890000,expiresAt:1234568490000,routes:expected});
 t.diagnostic(`${count} mixed routes: ${measured.statements} database calls`);
 assert.equal(measured.statements,mode==='existing'?5:7,'BEGIN, cell sequence, two route batches, COMMIT, plus two test-policy reads');
});

for(const publish of [false,true])test(`${publish?'published':'returned'} batches preserve empty-cell and move lifecycle boundaries`,async()=>{
 const target=await cell(),source=await cell(),empty=await cell(),account=await owner(),resident=await venue(account,target),moving=await venue(account,source);
 const operationId=randomUUID(),key=peer();
 await store.stageMove({operationId,installationId:moving.installationId,targetCellId:target.id,targetPeerPublicKey:key,port:9443,expectedRevision:1});
 const staged=await measuredExport(target.id,'test-free-paid',publish);
 await store.markMoveReady(operationId,1,staged.manifest.sequence);
 const ready=await measuredExport(target.id,'test-free-paid',publish);assert.deepEqual(ready.manifest.routes,staged.manifest.routes);
 await store.completeMove(operationId,1);
 const completed=await measuredExport(target.id,'test-free-paid',publish);assert.deepEqual(completed.manifest.routes,staged.manifest.routes);
 assert.deepEqual((await measuredExport(source.id,'test-free-paid',publish)).manifest.routes,[]);
 assert.deepEqual((await measuredExport(empty.id,'test-free-paid',publish)).manifest.routes,[]);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[moving.installationId]);
 assert.deepEqual((await measuredExport(target.id,'test-free-paid',publish)).manifest.routes.map(r=>r.installationId),[resident.installationId]);
});
