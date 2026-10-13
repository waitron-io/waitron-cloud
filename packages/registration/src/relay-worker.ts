import {createHmac,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {normaliseEmail} from './account-input.ts';
import {RelayError,RelayGrantStore,type RelayConfig} from './relay-grants.ts';
import {RelayKeys,messageError,type RelayKeyConfig,type RelayPayloadBinding} from './relay-payload.ts';
import {localRelaySmtp,relayTemplate,type RelayContent,type RelayDelivery} from './relay-smtp.ts';
import {transaction} from './transaction.ts';
import {RelayControl} from './relay-control.ts';
export interface RelayWorkerConfig {
 mode:'local-proof';grants:RelayConfig;payloadKeys:RelayKeyConfig;suppressionKeys:RelayKeyConfig;smtpPort:number;sendTimeoutMs?:number;
}
interface Row extends RelayPayloadBinding {
 payload:Buffer;binding:string;state:string;claim_id:string;lease_until:Date;expires_at:Date;attempts:number;
}
const states=['queued','sending','accepted','uncertain','failed','expired','cancelled'] as const;
type Terminal='accepted'|'uncertain'|'failed'|'expired'|'cancelled';
const key=(row:Row)=>[row.installation_id,row.message_id];
async function lockMessage(client:PoolClient,row:Row){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-message:'||$1||':'||$2,0))",key(row));}
const suppressionLock="SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-suppression',0))";

export class RelayWorker {
 readonly #pool:Pool;readonly #grants:RelayGrantStore|undefined;readonly #payload:RelayKeys|undefined;
 readonly #suppression=new Map<string,Buffer>();readonly #active:string|undefined;
 readonly #send:ReturnType<typeof localRelaySmtp>|undefined;readonly #timeout:number;
 constructor(pool:Pool,config?:RelayWorkerConfig){
  this.#pool=pool;this.#timeout=config?.sendTimeoutMs??20000;
  if(!config)return;
  if(config.mode!=='local-proof'||!Number.isInteger(this.#timeout)||this.#timeout<1||this.#timeout>20000)messageError('relay_unavailable');
  this.#grants=new RelayGrantStore(pool,config.grants);this.#payload=new RelayKeys(config.payloadKeys);
  new RelayKeys(config.suppressionKeys);
  for(const [id,value] of Object.entries(config.suppressionKeys.keys))this.#suppression.set(id,Buffer.from(value,'hex'));
  this.#active=config.suppressionKeys.activeKeyId;this.#send=localRelaySmtp(config.smtpPort);
 }
 #digest(id:string,recipient:string){return createHmac('sha256',this.#suppression.get(id)!).update(JSON.stringify(['relay-suppression-v1',recipient])).digest('hex');}
 async #checkSuppressionKeys(client:PoolClient){
  const ids=(await client.query('SELECT DISTINCT key_id FROM relay_suppressions')).rows;
  if(ids.some(row=>!this.#suppression.has(row.key_id)))messageError('relay_unavailable');
 }
 /** Trusted local administration only. No unauthenticated provider event endpoint is installed. */
 async suppress(recipient:string):Promise<void>{
  if(!this.#active||normaliseEmail(recipient)!==recipient)messageError('relay_unavailable');
  await transaction(this.#pool,async c=>{
   await c.query(suppressionLock);await this.#checkSuppressionKeys(c);
   await c.query('INSERT INTO relay_suppressions(key_id,digest) VALUES($1,$2) ON CONFLICT DO NOTHING',[this.#active,this.#digest(this.#active!,recipient)]);
  });
 }
 async status(){
  const counts=Object.fromEntries(states.map(s=>[s,0])) as Record<typeof states[number],number>;let attempts=0;
  for(const row of (await this.#pool.query('SELECT state,count(*)::integer AS count,COALESCE(sum(attempts),0)::integer AS attempts FROM relay_messages GROUP BY state')).rows){
   counts[row.state as typeof states[number]]=row.count;attempts+=row.attempts;
  }
  return {counts,attempts};
 }
 /** One bounded database claim and at most one local SMTP handoff. No config means no work. */
 async runOnce():Promise<boolean>{
  if(!this.#send)return false;
  const claimed=await transaction(this.#pool,async c=>{
   const control=await new RelayControl(this.#pool).lock(c);
   // Serialize capacity decisions across instances; row locks alone do not bound distinct messages.
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema()||':relay-worker-capacity',0))");
   const dead=(await c.query<Row>("SELECT * FROM relay_messages WHERE state='sending' AND lease_until<=clock_timestamp() ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
   if(dead){await this.#terminal(c,dead,'uncertain','uncertain');return null;}
   if(control.stopped)return undefined;
   const live=Number((await c.query("SELECT count(*) FROM relay_messages WHERE claim_id IS NOT NULL AND lease_until>clock_timestamp() AND state IN ('queued','sending')")).rows[0].count);
   if(live>=4)return undefined;
   const row=(await c.query<Row>(`SELECT * FROM relay_messages WHERE state='queued'
    AND (claim_id IS NULL OR lease_until<=clock_timestamp()) AND (available_at<=clock_timestamp() OR expires_at<=clock_timestamp())
    ORDER BY created_at,installation_id,message_id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
   if(!row)return undefined;
   return (await c.query<Row>(`UPDATE relay_messages SET claim_id=$3,lease_until=clock_timestamp()+interval '60 seconds'
    WHERE installation_id=$1 AND message_id=$2 RETURNING *`,[...key(row),randomUUID()])).rows[0]!;
  });
  if(claimed===undefined)return false;if(claimed===null)return true;
  const content=await this.#handoff(claimed);
  if(!content)return true;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  let result:RelayDelivery;
  try{
   const timeout=new Promise<RelayDelivery>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve('uncertain');},this.#timeout);});
   result=await Promise.race([this.#send(content,controller.signal),timeout]);
  }catch{result='uncertain';}
  finally{clearTimeout(timer);controller.abort();}
  // Database failure leaves durable sending for conservative recovery; never retry SMTP here.
  await this.#settle(claimed,result);return true;
 }
 async #terminal(c:PoolClient,row:Row,state:Terminal,reason:string|null){
  await c.query(`UPDATE relay_messages SET state=$3,reason=$4,payload=NULL,claim_id=NULL,lease_until=NULL,status_revision=status_revision+1
   WHERE installation_id=$1 AND message_id=$2`,[...key(row),state,reason]);
 }
 async #handoff(claim:Row):Promise<RelayContent|undefined>{
  return transaction(this.#pool,async c=>{
   const control=await new RelayControl(this.#pool).lock(c);
   await lockMessage(c,claim);
   if(control.stopped){
    // Release only this unstarted claim; stop must preserve ciphertext and delivery history.
    await c.query(`UPDATE relay_messages SET claim_id=NULL,lease_until=NULL
     WHERE installation_id=$1 AND message_id=$2 AND state='queued' AND claim_id=$3`,[...key(claim),claim.claim_id]);
    return;
   }
   // Match admission's lock order: message identity, authority, then the queue row.
   // A cancelled row needs no authority and must not mint a reservation.
   const candidate=(await c.query<Row>('SELECT * FROM relay_messages WHERE installation_id=$1 AND message_id=$2',key(claim))).rows[0];
   if(!candidate||candidate.state!=='queued'||candidate.claim_id!==claim.claim_id)return;
   let authorised=true;
   try{
    const installation=(await c.query('SELECT public_key FROM installations WHERE id=$1',[claim.installation_id])).rows[0];
    if(!installation)throw new RelayError('grant_unavailable');
    const reserved=await this.#grants!.reserve(c,{installationId:claim.installation_id,publicKey:installation.public_key},
     {grantId:claim.grant_id,grantRevision:claim.grant_revision,messageId:claim.message_id,binding:claim.binding});
    if(!reserved.replay)messageError('relay_unavailable');
   }catch(e){if(e instanceof RelayError&&e.code==='grant_unavailable')authorised=false;else throw e;}
   await c.query(suppressionLock);
   const row=(await c.query<Row>('SELECT * FROM relay_messages WHERE installation_id=$1 AND message_id=$2 FOR UPDATE',key(claim))).rows[0];
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
   if(!row||row.state!=='queued'||row.claim_id!==claim.claim_id||row.lease_until.getTime()<=now)return;
   if(row.expires_at.getTime()<=now){await this.#terminal(c,row,'expired','expired');return;}
   // Authority rows stay locked, but their deadlines can pass while another lock is busy.
   const live=authorised&&(await c.query(`SELECT 1 FROM relay_grants g JOIN installations i ON i.id=g.installation_id
    WHERE g.id=$1 AND g.expires_at>clock_timestamp() AND g.origin_verified_until>clock_timestamp()
    AND i.lease_expires_at>clock_timestamp()`,[row.grant_id])).rowCount;
   if(!live){await this.#terminal(c,row,'cancelled','cancelled');return;}
   if(row.attempts>=8){await this.#terminal(c,row,'failed','refused');return;}
   await this.#checkSuppressionKeys(c);
   let content:RelayContent;
   try{
    content=this.#payload!.open(row);relayTemplate(content);
    const grant=(await c.query('SELECT management_origin FROM relay_grants WHERE id=$1',[row.grant_id])).rows[0];
    if(content.managementOrigin!==grant.management_origin||content.messageId!==row.message_id||content.grantId!==row.grant_id||content.grantRevision!==row.grant_revision||content.class!==row.class)throw new Error();
   }catch{await this.#terminal(c,row,'failed','payload_unavailable');return;}
   for(const id of this.#suppression.keys()){
    if((await c.query('SELECT 1 FROM relay_suppressions WHERE key_id=$1 AND digest=$2',[id,this.#digest(id,content.recipient)])).rowCount){await this.#terminal(c,row,'failed','refused');return;}
   }
   // This commit is the handoff boundary. Later revoke/cancel cannot recall SMTP.
   const changed=await c.query(`UPDATE relay_messages SET state='sending',attempts=attempts+1,status_revision=status_revision+1
    WHERE installation_id=$1 AND message_id=$2 AND claim_id=$3 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()`,[...key(row),claim.claim_id]);
   return changed.rowCount?content:undefined;
  });
 }
 async #settle(claim:Row,result:RelayDelivery){
  await transaction(this.#pool,async c=>{
   const row=(await c.query<Row>("SELECT * FROM relay_messages WHERE installation_id=$1 AND message_id=$2 AND claim_id=$3 AND state='sending' FOR UPDATE",[...key(claim),claim.claim_id])).rows[0];
   if(!row)return;
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
   if(row.lease_until.getTime()<=now||result==='uncertain'){await this.#terminal(c,row,'uncertain','uncertain');return;}
   if(result==='accepted'){await this.#terminal(c,row,'accepted',null);return;}
   if(result==='refused'){await this.#terminal(c,row,'failed','refused');return;}
   const seconds=Math.min(900,30*2**(row.attempts-1));
   if(row.expires_at.getTime()<=now+seconds*1000){await this.#terminal(c,row,'expired','expired');return;}
   if(row.attempts>=8){await this.#terminal(c,row,'failed','refused');return;}
   await c.query(`UPDATE relay_messages SET state='queued',reason=NULL,claim_id=NULL,lease_until=NULL,
    available_at=$3::timestamptz+$4*interval '1 second',status_revision=status_revision+1 WHERE installation_id=$1 AND message_id=$2`,[...key(row),new Date(now),seconds]);
  });
 }
}
