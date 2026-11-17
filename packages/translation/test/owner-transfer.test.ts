import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createSession} from '../../identity/src/index.ts';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {OwnerTransferStore} from '../../registration/src/owner-transfer.ts';
import {prepareConnectionProof} from '../../registration/test/fixtures/action-proof.ts';
import {connectedVenue,database,giveConsent} from './fixtures.ts';
import {createJob,jobFingerprint,TranslationWorker} from '../src/index.ts';

for(const inFlight of [false,true])test(`handover ends ${inFlight?'in-flight':'queued'} customer work without changing other venues`,async()=>{
 const db=await database(),issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 let release:()=>void=()=>{},work:Promise<boolean>|undefined;
 try{
  const venue=await connectedVenue(db,issuer,'https://cloud.example.test'),other=await connectedVenue(db,issuer,'https://cloud.example.test');
  await giveConsent(db,venue);await giveConsent(db,other);
  const sender=await transaction(db.pool,c=>createSession(c,venue.accountId)),recipient=await transaction(db.pool,c=>createSession(c,other.accountId));
  await prepareConnectionProof(db.pool,venue.accountId,sender.token);await prepareConnectionProof(db.pool,other.accountId,recipient.token);
  const body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:[{ref:'drink:1',kind:'product',family:'drink:1',category:'Drinks',staffName:'Cafè',existing:{},missing:['es']}],houseStyle:[]});
  const job=await transaction(db.pool,c=>createJob(c,{installationId:venue.installationId,venueId:venue.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:1}));
  let calls=0,entered:()=>void=()=>{};const started=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;});
  const worker=new TranslationWorker(db.pool,{provider:'openai',model:'gpt-6-luna',async respond(){calls++;entered();await hold;return {text:JSON.stringify({products:[{ref:'drink:1',names:{es:'Café'},placeholder:false,corrections:[]}]}),inputTokens:1,outputTokens:1};}},{scope:{installationId:venue.installationId,venueId:venue.venueId},wait:async()=>{}});
  if(inFlight){work=worker.runOnce(new AbortController().signal);await started;}
  const transfers=new OwnerTransferStore(db.pool,db.outbox),recipientEmail=(await db.pool.query('SELECT email FROM cloud_credentials WHERE account_id=$1',[other.accountId])).rows[0].email;
  const offer=await transfers.create(sender.token,sender.csrfToken,venue.organisationId,recipientEmail);await transfers.decide(recipient.token,recipient.csrfToken,offer.id,'accept');
  release();if(work)await work;else await worker.runOnce(new AbortController().signal);
  assert.equal(calls,inFlight?1:0,'queued work never dispatches; in-flight work never makes the next call');
  const row=(await db.pool.query('SELECT state,reason,lease_id,lease_until FROM translation_jobs WHERE id=$1',[job.id])).rows[0];
  assert.deepEqual(row,{state:'failed',reason:'consent_required',lease_id:null,lease_until:null});
  assert.ok((await db.pool.query('SELECT withdrawn_at FROM translation_consents WHERE venue_id=$1',[venue.venueId])).rows[0].withdrawn_at);
  assert.equal((await db.pool.query('SELECT withdrawn_at FROM translation_consents WHERE venue_id=$1',[other.venueId])).rows[0].withdrawn_at,null);
 }finally{release();await work?.catch(()=>{});await db.close();}
});
