import assert from 'node:assert/strict';
import {createPrivateKey,randomBytes,randomUUID,sign} from 'node:crypto';
import {source,accountState,factorState} from './schema-upgrade-fixture.mjs';

export async function storedRows(pool,includeControl=false){
 const tables=(await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema()
  AND tablename NOT IN ('schema_migrations'${includeControl?'':",'relay_control'"}) ORDER BY tablename`)).rows;
 const state={};
 for(const {tablename} of tables)state[tablename]=(await pool.query(`SELECT to_jsonb(t) AS value FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
 return state;
}
export async function relayState(pool){
 const state=await storedRows(pool);return Object.fromEntries(Object.entries(state).filter(([name])=>name.startsWith('relay_')));
}
export async function identityAccountState(pool){return{accounts:await accountState(pool),factors:await factorState(pool)};}

// All keys and grant values are synthetic inputs held only by this local proof.
export async function seedRelay(root,pool,state,issuerKey){
 const {RelayMessages}=await source(root,'packages/registration/src/relay-messages.ts');
 const {RelayGrantStore}=await source(root,'packages/registration/src/relay-grants.ts');
 const {RelayWorker}=await source(root,'packages/registration/src/relay-worker.ts');
 const {createLeaseIssuer,encodeMachine}=await source(root,'packages/registration/src/installation-proof.ts');
 const {InstallationStore}=await source(root,'packages/registration/src/installations.ts');
 const origin='http://127.0.0.1:3000',issuer=createLeaseIssuer(issuerKey),installation=state.installations[1],owner=state.owners[1];
 const privateKey=createPrivateKey({key:Buffer.from(installation.privateKey,'base64url'),format:'der',type:'pkcs8'});
 let lease='';
 const proof=(action,body)=>{
  const payload=encodeMachine({origin,action,installationId:installation.installationId,operationId:action==='email-submit'?body.messageId:randomUUID(),issuedAt:Date.now(),lease,body:JSON.stringify(body)});
  return{payload:payload.toString('base64url'),signature:sign(null,payload,privateKey).toString('base64url')};
 };
 const renewed=await new InstallationStore(pool,issuer,origin).execute('renew',proof('renew',{}));lease=JSON.stringify(renewed.lease);
 const grants={mode:'local-proof',consentVersion:'upgrade-local-v1',policy:{version:'upgrade-local-v1',units:100,periodSeconds:3600,epoch:'2026-01-01T00:00:00.000Z',excess:'refuse',debit:'retain'},verifyOrigin:async request=>({...request,domainControl:true,httpsEndpoint:true,expiresAt:new Date(Date.now()+7200000).toISOString()})};
 const key=id=>({activeKeyId:id,keys:{[id]:randomBytes(32).toString('hex')}});
 const config={mode:'local-proof',grants,payloadKeys:key('payload-v1'),replayKeys:key('replay-v1'),bounds:{version:'upgrade-local-v1',epoch:'2026-01-01T00:00:00.000Z',windowSeconds:3600,recipientLimit:100,grantLimit:100,queuedPayloadBytes:1000000,maxCounterRows:1000,recipientKeys:key('bounds-v1')}};
 const suppressionKeys=key('suppression-v1');
 const grant=await new RelayGrantStore(pool,grants).approve(owner.credentials.token,owner.credentials.csrfToken,{installationId:installation.installationId,expectedRevision:0,consent:true,consentVersion:grants.consentVersion,managementOrigin:'https://manage.example.test',expiresAt:new Date(Date.now()+3600000).toISOString()});
 const body=()=>({version:1,messageId:randomUUID(),grantId:grant.id,grantRevision:grant.revision,class:'password_reset',recipient:'relay-upgrade@example.test',displayName:'Upgrade owner',locale:'en',timeZone:'Europe/Rome',expiresAt:new Date(Date.now()+1800000).toISOString(),token:randomBytes(32).toString('base64url')});
 const messages=new RelayMessages(pool,issuer,origin,config),bodies={};
 for(const name of ['queued','delayed','claimed','sending','terminal','cancel']){
  bodies[name]=body();assert.equal((await messages.execute('email-submit',proof('email-submit',bodies[name]))).created,true);
 }
 await pool.query("UPDATE relay_messages SET available_at=clock_timestamp()+interval '20 minutes' WHERE message_id=$1",[bodies.delayed.messageId]);
 await pool.query("UPDATE relay_messages SET claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '20 minutes' WHERE message_id=$1",[bodies.claimed.messageId]);
 await pool.query("UPDATE relay_messages SET state='sending',claim_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '20 minutes',attempts=1 WHERE message_id=$1",[bodies.sending.messageId]);
 await pool.query("UPDATE relay_messages SET state='accepted',payload=NULL WHERE message_id=$1",[bodies.terminal.messageId]);
 await new RelayWorker(pool,{...config,suppressionKeys,smtpPort:1025}).suppress('suppressed@example.test');
 const rows=(await pool.query('SELECT state FROM relay_messages ORDER BY created_at')).rows;
 assert.deepEqual(rows.map(r=>r.state),['queued','queued','queued','sending','accepted','queued']);
 assert.equal((await pool.query('SELECT count(*) FROM relay_reservations')).rows[0].count,'6');
 await byteInvariant(pool);
 return{config,suppressionKeys,issuer,origin,proof,body,bodies};
}

async function byteInvariant(pool){
 const row=(await pool.query('SELECT (SELECT bytes FROM relay_queue_bytes WHERE singleton)::text AS tally,COALESCE(sum(COALESCE(octet_length(payload),0)),0)::text AS actual FROM relay_messages')).rows[0];
 assert.equal(row.tally,row.actual);assert.ok(Number(row.tally)>=0);
}
export async function stoppedRelay(root,pool,proof,smtpPort){
 const {RelayMessages}=await source(root,'packages/registration/src/relay-messages.ts');
 const {RelayWorker}=await source(root,'packages/registration/src/relay-worker.ts');
 const messages=new RelayMessages(pool,proof.issuer,proof.origin,proof.config),before=await relayState(pool);
 await assert.rejects(messages.execute('email-submit',proof.proof('email-submit',proof.body())),error=>error.code==='relay_disabled');
 assert.equal(await new RelayWorker(pool,{...proof.config,suppressionKeys:proof.suppressionKeys,smtpPort}).runOnce(),false);
 assert.deepEqual(await relayState(pool),before,'stop preserves relay data and spends nothing');
 await byteInvariant(pool);
 return true;
}

export async function restoredRelay(root,pool,proof,smtpPort,resume){
 const {RelayMessages}=await source(root,'packages/registration/src/relay-messages.ts');
 const {RelayWorker}=await source(root,'packages/registration/src/relay-worker.ts');
 const {RelayKeys}=await source(root,'packages/registration/src/relay-payload.ts');
 const make=config=>new RelayMessages(pool,proof.issuer,proof.origin,config);
 const messages=make(proof.config),queued=proof.bodies.queued;
 const row=(await pool.query('SELECT * FROM relay_messages WHERE message_id=$1',[queued.messageId])).rows[0];
 assert.deepEqual(new RelayKeys(proof.config.payloadKeys).open(row),{...queued,managementOrigin:'https://manage.example.test'});
 const before=await relayState(pool);
 assert.equal((await messages.execute('email-status',proof.proof('email-status',{version:1,messageId:queued.messageId}))).status.state,'queued');
 assert.equal((await messages.execute('email-submit',proof.proof('email-submit',queued))).created,false);
 assert.deepEqual(await relayState(pool),before,'restored exact retry has no extra spend');
 for(const field of ['payloadKeys','replayKeys']){
  const original=proof.config[field],id=original.activeKeyId;
  for(const [kind,keys] of [['wrong',{activeKeyId:id,keys:{[id]:randomBytes(32).toString('hex')}}],['missing',{activeKeyId:'replacement',keys:{replacement:randomBytes(32).toString('hex')}}]]){
   const broken=make({...proof.config,[field]:keys});
   const action=field==='payloadKeys'?'email-status':'email-submit',body=action==='email-status'?{version:1,messageId:queued.messageId}:queued;
   await assert.rejects(broken.execute(action,proof.proof(action,body)),error=>error.code===(field==='replayKeys'&&kind==='wrong'?'message_conflict':'relay_unavailable'));
   assert.deepEqual(await relayState(pool),before,'key refusal cannot mutate restored state');
  }
 }
 assert.equal((await messages.execute('email-cancel',proof.proof('email-cancel',{version:1,messageId:proof.bodies.cancel.messageId}))).status.state,'cancelled');
 await stoppedRelay(root,pool,proof,smtpPort);
 await resume();
 const workerConfig={...proof.config,suppressionKeys:proof.suppressionKeys,smtpPort};
 const missingSuppression={activeKeyId:'replacement',keys:{replacement:randomBytes(32).toString('hex')}};
 await assert.rejects(new RelayWorker(pool,{...workerConfig,suppressionKeys:missingSuppression}).runOnce(),error=>error.code==='relay_unavailable');
 assert.equal((await pool.query('SELECT state FROM relay_messages WHERE message_id=$1',[queued.messageId])).rows[0].state,'queued');
 // The refused historical key leaves only a bounded queued lease, never a send.
 await pool.query("UPDATE relay_messages SET lease_until=clock_timestamp()-interval '1 second' WHERE message_id=$1",[queued.messageId]);
 assert.equal(await new RelayWorker(pool,workerConfig).runOnce(),true);
 assert.equal((await pool.query('SELECT state FROM relay_messages WHERE message_id=$1',[queued.messageId])).rows[0].state,'accepted');
 const admitted=proof.body();assert.equal((await messages.execute('email-submit',proof.proof('email-submit',admitted))).created,true);
 assert.equal(await new RelayWorker(pool,workerConfig).runOnce(),true);
 assert.equal((await pool.query('SELECT state FROM relay_messages WHERE message_id=$1',[admitted.messageId])).rows[0].state,'accepted');
 await byteInvariant(pool);
 return true;
}
