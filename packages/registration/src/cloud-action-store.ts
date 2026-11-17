import type {EmailOutbox,EmailDeliveryStatus} from './email-outbox.ts';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
export type CloudActionProposal={occurrence:string;actionId:string;cell:string;target:string;proposal:string;evidence:string};
export type CloudActionDecision={requestId:string;version:number;decision:'approved'|'rejected'};
export class CloudActionError extends Error{
 readonly code:'invalid_input'|'conflict';
 constructor(code:'invalid_input'|'conflict'){super(code);this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const binding=['occurrence','actionId','cell','target','proposal','evidence'] as const;
export function validateCloudActionProposal(input:CloudActionProposal){
 if(!input||typeof input!=='object'||Object.keys(input).length!==binding.length||binding.some(key=>
  typeof input[key]!=='string'||!input[key].trim()||input[key].includes('\0')||input[key].length>(key==='proposal'||key==='evidence'?1000:160)))throw new CloudActionError('invalid_input');
}
function view(row:any,events:any[]=[]){return {
 id:row.id,occurrence:row.occurrence,version:row.version,actionId:row.action_id,policy:row.policy as 'ask-first'|'act-and-report',cell:row.cell,target:row.target,
 proposal:row.proposal,evidence:row.evidence,state:row.state as 'pending'|'approved'|'rejected'|'superseded',effectId:row.effect_id,available:false as const,
 dispatchStartedAt:row.dispatch_started_at?.toISOString()??null as string|null,
 outcome:row.outcome as {status:'confirmed'}|null,
 createdAt:row.created_at.toISOString() as string,decidedAt:row.decided_at?.toISOString()??null as string|null,
 approvalExpiresAt:row.approval_expires_at?.toISOString()??null as string|null,
 events:events.map(event=>({kind:event.kind as string,at:event.created_at.toISOString() as string,...(event.kind==='notice'?{noticeStatus:(event.delivery_status??'unknown') as keyof EmailDeliveryStatus['counts']|'unknown'}:{})})),
};}
export type CloudActionRequest=ReturnType<typeof view>;
export async function readCloudActionRequest(client:PoolClient,id:string){
 const row=(await client.query('SELECT * FROM cloud_action_requests WHERE id=$1',[id])).rows[0];
 if(!row)throw new CloudActionError('conflict');
 return view(row,(await client.query('SELECT event.kind,event.created_at,mail.status AS delivery_status FROM cloud_action_events event LEFT JOIN email_outbox mail ON mail.id=event.notice_id WHERE event.request_id=$1 ORDER BY event.created_at,event.id',[id])).rows);
}
export async function readCloudActionRequests(client:PoolClient){
 const rows=(await client.query(`SELECT * FROM cloud_action_requests WHERE (state='pending' AND outcome IS NULL) OR id IN
  (SELECT id FROM cloud_action_requests WHERE state<>'pending' OR outcome IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 50)
  ORDER BY (state='pending' AND outcome IS NULL) DESC,created_at DESC,id DESC`)).rows;
 if(!rows.length)return [];
 const events=(await client.query('SELECT event.request_id,event.kind,event.created_at,mail.status AS delivery_status FROM cloud_action_events event LEFT JOIN email_outbox mail ON mail.id=event.notice_id WHERE event.request_id=ANY($1::uuid[]) ORDER BY event.created_at,event.id',[rows.map(row=>row.id)])).rows;
 return rows.map(row=>view(row,events.filter(event=>event.request_id===row.id)));
}
async function event(client:PoolClient,requestId:string,kind:string,actor:string){
 await client.query('INSERT INTO cloud_action_events(id,request_id,kind,actor_account_id) VALUES($1,$2,$3,$4)',[randomUUID(),requestId,kind,actor]);
}
async function proposalWithNotice(client:PoolClient,id:string,actor:string,outbox:EmailOutbox){
 const request=await readCloudActionRequest(client,id);
 if(request.state!=='pending'||request.events.some(event=>event.kind==='notice'))return request;
 const account=(await client.query(`SELECT credential.email,preferences.locale FROM cloud_accounts account
  JOIN cloud_credentials credential ON credential.account_id=account.id LEFT JOIN account_alert_preferences preferences ON preferences.account_id=account.id
  WHERE account.id=$1 AND account.disabled_at IS NULL AND credential.email_verified_at IS NOT NULL`,[actor])).rows[0];
 if(!account)throw Error('cloud_operator_email_unavailable');
 const notice=await outbox.enqueue(client,'operator_notice',{email:account.email,locale:account.locale??'en'});
 await client.query("INSERT INTO cloud_action_events(id,request_id,kind,actor_account_id,notice_id) VALUES($1,$2,'notice',$3,$4)",[randomUUID(),id,actor,notice]);
 return readCloudActionRequest(client,id);
}
export async function proposeCloudAction(client:PoolClient,input:CloudActionProposal,policy:'ask-first'|'act-and-report',actor:string,outbox:EmailOutbox){
 // All versions of one observed incident share a turn, including its first insertion.
 await client.query("SELECT pg_advisory_xact_lock(hashtext('cloud-action-occurrence'),hashtext($1))",[input.occurrence]);
 const replay=(await client.query(`SELECT id FROM cloud_action_requests WHERE occurrence=$1 AND action_id=$2 AND cell=$3 AND target=$4 AND proposal=$5 AND evidence=$6 AND policy=$7`,[input.occurrence,input.actionId,input.cell,input.target,input.proposal,input.evidence,policy])).rows[0];
 if(replay)return proposalWithNotice(client,replay.id,actor,outbox);
 const prior=(await client.query('SELECT * FROM cloud_action_requests WHERE occurrence=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE',[input.occurrence])).rows[0];
 if(prior){
  const original=view(prior);
  if(binding.every(key=>input[key]===original[key])&&policy===original.policy)return proposalWithNotice(client,prior.id,actor,outbox);
  await client.query("UPDATE cloud_action_requests SET state='superseded' WHERE id=$1",[prior.id]);await event(client,prior.id,'superseded',actor);
 }
 const id=randomUUID();await client.query(`INSERT INTO cloud_action_requests(id,occurrence,version,action_id,policy,cell,target,proposal,evidence,effect_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,input.occurrence,(prior?.version??0)+1,input.actionId,policy,input.cell,input.target,input.proposal,input.evidence,randomUUID()]);
 await event(client,id,'proposed',actor);return proposalWithNotice(client,id,actor,outbox);
}
export async function decideCloudAction(client:PoolClient,input:CloudActionDecision,actor:string){
 if(!input||Object.keys(input).sort().join(',')!=='decision,requestId,version'||!uuid.test(input.requestId)||!Number.isSafeInteger(input.version)||input.version<1||!['approved','rejected'].includes(input.decision))throw new CloudActionError('invalid_input');
 const row=(await client.query('SELECT * FROM cloud_action_requests WHERE id=$1 FOR UPDATE',[input.requestId])).rows[0];
 if(!row||row.policy!=='ask-first'||row.dispatch_started_at||row.outcome||row.version!==input.version||row.state!=='pending'&&row.state!==input.decision)throw new CloudActionError('conflict');
 if(row.state==='pending'){
  await client.query(`WITH moment AS (SELECT clock_timestamp() AS now) UPDATE cloud_action_requests SET state=$2,decided_at=moment.now,
   approval_expires_at=CASE WHEN $2='approved' THEN moment.now+interval '15 minutes' END FROM moment WHERE id=$1`,[input.requestId,input.decision]);
  await event(client,input.requestId,input.decision,actor);
 }
 return readCloudActionRequest(client,input.requestId);
}
