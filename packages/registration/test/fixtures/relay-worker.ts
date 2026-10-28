import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {migrate} from '../../src/migrate.ts';
import {transaction} from '../../src/transaction.ts';
import {RelayGrantStore,type RelayConfig} from '../../src/relay-grants.ts';
import {RelayMessages,type RelayAdmissionConfig} from '../../src/relay-messages.ts';
import {createLeaseIssuer,encodeMachine} from '../../src/installation-proof.ts';
function reportSetupFailure(stage:string){
 // Keep failure reporting independent of query inputs and the thrown value.
 try{console.error(JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage}));}catch{}
}
export async function fixture(initialise=migrate){
 const schema=`relay_worker_${randomUUID().replaceAll('-','')}`;
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema,options:`-c search_path=${schema} -c statement_timeout=5000`});
 let created=false;
 let stage='create-schema';
 async function close(){
  try{await pool.end();}
  finally{try{if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.end();}}
 }
 try{
 await admin.query(`CREATE SCHEMA ${schema}`);created=true;stage='migrate';await initialise(pool);
 stage='issuer-create';
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const grants:RelayConfig={mode:'local-proof',consentVersion:'local-v1',policy:{version:'local-v1',units:100,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},verifyOrigin:async r=>({...r,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+7200000).toISOString()})};
 // Worker tests exercise handoff and stop, so their counters start with the database fixture.
 stage='bounds-clock';
 const boundsEpoch=(await pool.query('SELECT clock_timestamp() AS now')).rows[0].now.toISOString();
 stage='relay-config';
 const relay:RelayAdmissionConfig={mode:'local-proof',grants,payloadKeys:{activeKeyId:'p1',keys:{p1:randomBytes(32).toString('hex')}},replayKeys:{activeKeyId:'r1',keys:{r1:randomBytes(32).toString('hex')}},bounds:{version:'ample-local-v1',epoch:boundsEpoch,windowSeconds:3600,recipientLimit:1000,grantLimit:1000,queuedPayloadBytes:10000000,maxCounterRows:10000,recipientKeys:{activeKeyId:'b1',keys:{b1:randomBytes(32).toString('hex')}}}};
 const config={mode:'local-proof' as const,grants,payloadKeys:relay.payloadKeys,suppressionKeys:{activeKeyId:'s1',keys:{s1:randomBytes(32).toString('hex')}},smtpPort:Number(process.env.MAILPIT_TEST_SMTP_PORT)};
 const messages=new RelayMessages(pool,issuer,'http://localhost',relay);
 async function venue(){
  let stage='venue-prepare';
  try{
  const account=randomUUID(),organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID();
  const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
  stage='account-insert';
  await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[account]);
  stage='credential-insert';
  await pool.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[account,`${account}@example.test`]);
  stage='organisation-insert';
  await pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);
  stage='membership-insert';
  await pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)',[account,organisation]);
  stage='business-insert';
  await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);
  stage='venue-insert';
  await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
  stage='installation-insert';
  await pool.query("INSERT INTO installations(id,venue_id,public_key,lease_expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[installation,venue,publicKey]);
  stage='session-create';
  const session=await transaction(pool,c=>createSession(c,account));
  stage='grant-approve';
  const grant=await new RelayGrantStore(pool,grants).approve(session.token,session.csrfToken,{installationId:installation,expectedRevision:0,consent:true,consentVersion:'local-v1',managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+3600000).toISOString()});
  stage='lease-build';
  const issuedAt=Date.now();
  const leaseInput={origin:'http://localhost',leaseId:randomUUID(),installationId:installation,venueId:venue,environment:'test' as const,publicKey,issuedAt,expiresAt:issuedAt+3600000};
  const lease=issuer.issue(leaseInput);
  function proof(action:'email-submit'|'email-status'|'email-cancel',body:any,overrides:{issuedAt?:number;leaseExpiresAt?:number}={}){
   const payload=encodeMachine({origin:'http://localhost',action,installationId:installation,operationId:action==='email-submit'?body.messageId:randomUUID(),issuedAt:overrides.issuedAt??Date.now(),lease:JSON.stringify(overrides.leaseExpiresAt?issuer.issue({...leaseInput,expiresAt:overrides.leaseExpiresAt}):lease),body:JSON.stringify(body)});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  }
  async function submit(change:Record<string,unknown>={}){
   const body:any={version:1,messageId:randomUUID(),grantId:grant.id,grantRevision:1,class:'password_reset',recipient:`${randomUUID()}@example.test`,displayName:'Ana & Bea',locale:'es-ES',timeZone:'Europe/Madrid',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url'),...change};
   if(body.class==='email_change'){delete body.token;body.code='123456';body.codeExpiresAt=new Date(Date.now()+600000).toISOString();}
   await messages.execute('email-submit',proof('email-submit',body));return body;
  }
  return {account,organisation,installation,grant,session,submit,proof,async cancel(messageId:string){return messages.execute('email-cancel',proof('email-cancel',{version:1,messageId}));}};
  }catch(error){reportSetupFailure(stage);throw error;}
 }
 return {schema,pool,issuer,config,relay,messages,venue,async row(id:string){const invariant=(await pool.query('SELECT (SELECT bytes FROM relay_queue_bytes WHERE singleton)::text AS tally,COALESCE(sum(COALESCE(octet_length(payload),0)),0)::text AS actual FROM relay_messages')).rows[0];assert.equal(invariant.tally,invariant.actual,'retained ciphertext byte invariant');return (await pool.query('SELECT * FROM relay_messages WHERE message_id=$1',[id])).rows[0];},close};
 }catch(error){
  reportSetupFailure(stage);
  try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Relay fixture setup and cleanup failed',{cause:error});}
  throw error;
 }
}
