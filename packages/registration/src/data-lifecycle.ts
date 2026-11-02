import type {Pool,PoolClient} from 'pg';
import {transaction} from './transaction.ts';

export interface LifecycleRef {venueId:string;revision:number}
export type LifecycleState='active'|'exit preparing'|'read-only until deadline'|'purging'|'purged';
export type LifecycleKind='cancel'|'delete'|'resubscribe'|'export';
export interface LifecycleRequest {
 venueId:string;operationId:string;expectedRevision:number;kind:LifecycleKind;fingerprint:string;effectiveEndAt?:string;
}
export interface LifecycleOperation {
 operationId:string;kind:LifecycleKind;fingerprint:string;revision:number;requestedAt:string;
 effectiveEndAt:string|null;deadlineAt:string|null;claimRevision:number;leaseUntil:string|null;
}
export interface LifecycleEffect {
 operationId:string;effectId:string;requestFingerprint:string;phase:'intent'|'uncertain'|'confirmed'|'refused';resourceReference:string|null;
}
export type LifecycleEffectInput=Omit<LifecycleEffect,'operationId'|'resourceReference'>&{resourceReference?:string};
export interface LifecycleView {
 ref:LifecycleRef;state:LifecycleState;requestedAt:string;effectiveEndAt:string|null;deadlineAt:string|null;
 operations:LifecycleOperation[];effects:LifecycleEffect[];
}
export class LifecycleError extends Error {
 readonly code:'invalid_lifecycle_input'|'lifecycle_unavailable'|'lifecycle_conflict'|'stale_lifecycle_claim'|'effect_uncertain';
 constructor(code:LifecycleError['code']){super(code);this.name='LifecycleError';this.code=code;}
}
function fail(code:LifecycleError['code']):never{throw new LifecycleError(code);}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprint=/^[a-f0-9]{64}$/;
const id=(value:unknown)=>typeof value==='string'&&uuid.test(value);
const revision=(value:unknown)=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=2147483647;
function serviceEnd(value:unknown):boolean {
 if(typeof value!=='string')return false;
 const instant=new Date(value),deadline=new Date(instant.getTime()+90*24*60*60*1000);
 return Number.isFinite(instant.getTime())&&instant.getUTCFullYear()>=1&&deadline.getUTCFullYear()<=9999&&instant.toISOString()===value;
}
function validateRequest(input:LifecycleRequest):void {
 if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['venueId','operationId','expectedRevision','kind','fingerprint','effectiveEndAt'].includes(key))
  ||!id(input.venueId)||!id(input.operationId)||!revision(input.expectedRevision)
  ||!['cancel','delete','resubscribe','export'].includes(input.kind)||typeof input.fingerprint!=='string'||!fingerprint.test(input.fingerprint)
  ||input.effectiveEndAt!==undefined&&(input.kind!=='cancel'||!serviceEnd(input.effectiveEndAt)))fail('invalid_lifecycle_input');
}
interface Row {venue_id:string;revision:number;state:LifecycleState;requested_at:Date;effective_end_at:Date|null;deadline_at:Date|null}
interface OperationRow {
 operation_id:string;kind:LifecycleKind;fingerprint:string;expected_revision:number;revision:number;
 requested_effective_end_at:Date|null;requested_at:Date;effective_end_at:Date|null;deadline_at:Date|null;
 claim_revision:number;claim_lifecycle_revision:number|null;lease_until:Date|null;
}
const iso=(value:Date|null)=>value?.toISOString()??null;
async function locked(client:PoolClient,ref:LifecycleRef):Promise<Row>{
 if(!ref||!id(ref.venueId)||!revision(ref.revision)||ref.revision<1)fail('invalid_lifecycle_input');
 const row=(await client.query<Row>('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[ref.venueId])).rows[0];
 if(!row||row.revision!==ref.revision)fail('lifecycle_conflict');return row;
}

// Internal journal only: a recorded request or outcome grants no permission to run its effect.
export class LifecycleStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}

 async request(input:LifecycleRequest):Promise<LifecycleRef>{
  // Bind the operation before borrowing a connection; callers retain their input object.
  input={...input};
  validateRequest(input);
  return transaction(this.#pool,async client=>{
   if(!(await client.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[input.venueId])).rowCount)fail('lifecycle_unavailable');
   const row=(await client.query<Row>('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR UPDATE',[input.venueId])).rows[0];
   const prior=(await client.query<OperationRow>('SELECT * FROM data_lifecycle_operations WHERE venue_id=$1 AND operation_id=$2',[input.venueId,input.operationId])).rows[0];
   if(prior){
    if(prior.kind!==input.kind||prior.fingerprint!==input.fingerprint||prior.expected_revision!==input.expectedRevision
     ||iso(prior.requested_effective_end_at)!==(input.effectiveEndAt??null))fail('lifecycle_conflict');
    return {venueId:input.venueId,revision:prior.revision};
   }
   if((row?.revision??0)!==input.expectedRevision||input.expectedRevision===2147483647)fail('lifecycle_conflict');
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(row&&(row.state==='purging'||row.state==='purged'||input.kind==='resubscribe'&&row.deadline_at!==null&&row.deadline_at.getTime()<=now.getTime()))fail('lifecycle_unavailable');
   let end=row?.effective_end_at??null;
   if(input.kind==='cancel'){
    if(end&&input.effectiveEndAt!==undefined&&end.toISOString()!==input.effectiveEndAt)fail('lifecycle_conflict');
    end??=input.effectiveEndAt===undefined?now:new Date(input.effectiveEndAt);
   }
   const deadline=end?new Date(end.getTime()+90*24*60*60*1000):null;
   const next=input.expectedRevision+1;
   const state=(!row||row.state==='active')&&(input.kind==='cancel'||input.kind==='delete')?'exit preparing':row?.state??'active';
   await client.query(`INSERT INTO data_lifecycles(venue_id,revision,state,requested_at,effective_end_at,deadline_at)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(venue_id) DO UPDATE SET revision=$2,state=$3,requested_at=$4,
    effective_end_at=COALESCE(data_lifecycles.effective_end_at,$5),deadline_at=COALESCE(data_lifecycles.deadline_at,$6)`,
   [input.venueId,next,state,now,end,deadline]);
   await client.query("UPDATE data_lifecycle_effects SET phase='uncertain' WHERE venue_id=$1 AND phase='intent'",[input.venueId]);
   await client.query('UPDATE data_lifecycle_operations SET lease_until=NULL,claim_lifecycle_revision=NULL WHERE venue_id=$1',[input.venueId]);
   await client.query(`INSERT INTO data_lifecycle_operations(venue_id,operation_id,kind,fingerprint,expected_revision,revision,requested_effective_end_at,requested_at,effective_end_at,deadline_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,effective_end_at,deadline_at FROM data_lifecycles WHERE venue_id=$1`,[input.venueId,input.operationId,input.kind,input.fingerprint,input.expectedRevision,next,input.effectiveEndAt??null,now]);
   return {venueId:input.venueId,revision:next};
  });
 }

 async read(venueId:string):Promise<LifecycleView>{
  if(!id(venueId))fail('invalid_lifecycle_input');
  return transaction(this.#pool,async client=>{
   const row=(await client.query<Row>('SELECT * FROM data_lifecycles WHERE venue_id=$1 FOR SHARE',[venueId])).rows[0];
   if(!row)fail('lifecycle_unavailable');
   const operations=(await client.query<OperationRow>('SELECT * FROM data_lifecycle_operations WHERE venue_id=$1 ORDER BY revision',[venueId])).rows;
   const effects=(await client.query('SELECT * FROM data_lifecycle_effects WHERE venue_id=$1 ORDER BY operation_id,effect_id',[venueId])).rows;
   return {ref:{venueId,revision:row.revision},state:row.state,requestedAt:row.requested_at.toISOString(),effectiveEndAt:iso(row.effective_end_at),deadlineAt:iso(row.deadline_at),
    operations:operations.map(op=>({operationId:op.operation_id,kind:op.kind,fingerprint:op.fingerprint,revision:op.revision,requestedAt:op.requested_at.toISOString(),
     effectiveEndAt:iso(op.effective_end_at),deadlineAt:iso(op.deadline_at),claimRevision:op.claim_revision,leaseUntil:iso(op.lease_until)})),
    effects:effects.map(effect=>({operationId:effect.operation_id,effectId:effect.effect_id,requestFingerprint:effect.request_fingerprint,phase:effect.phase,resourceReference:effect.resource_reference}))};
  });
 }

 async claim(ref:LifecycleRef,operationId:string):Promise<{claimRevision:number}|null>{
  ref={...ref};
  if(!id(operationId))fail('invalid_lifecycle_input');
  return transaction(this.#pool,async client=>{
   await locked(client,ref);
   const operation=(await client.query<OperationRow>('SELECT * FROM data_lifecycle_operations WHERE venue_id=$1 AND operation_id=$2',[ref.venueId,operationId])).rows[0];
   if(!operation)return null;
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if((await client.query('SELECT 1 FROM data_lifecycle_operations WHERE venue_id=$1 AND lease_until>$2',[ref.venueId,now])).rowCount)return null;
   if(operation.claim_revision>=2147483647)fail('lifecycle_conflict');
   // A vanished claimant cannot tell us whether its recorded call reached the outside service.
   await client.query("UPDATE data_lifecycle_effects SET phase='uncertain' WHERE venue_id=$1 AND phase='intent'",[ref.venueId]);
   const claimRevision=operation.claim_revision+1;
   await client.query(`UPDATE data_lifecycle_operations SET claim_revision=$3,claim_lifecycle_revision=$4,
    lease_until=$5::timestamptz+interval '60 seconds' WHERE venue_id=$1 AND operation_id=$2`,[ref.venueId,operationId,claimRevision,ref.revision,now]);
   return {claimRevision};
  });
 }

 async recordEffect(ref:LifecycleRef,operationId:string,claimRevision:number,effect:LifecycleEffectInput):Promise<void>{
  ref={...ref};effect={...effect};
  if(!id(operationId)||!revision(claimRevision)||claimRevision<1||!effect||typeof effect!=='object'
   ||Object.keys(effect).some(key=>!['effectId','requestFingerprint','phase','resourceReference'].includes(key))
   ||!id(effect.effectId)||typeof effect.requestFingerprint!=='string'||!fingerprint.test(effect.requestFingerprint)
   ||!['intent','uncertain','confirmed','refused'].includes(effect.phase)
   ||effect.resourceReference!==undefined&&(typeof effect.resourceReference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/.test(effect.resourceReference)))fail('invalid_lifecycle_input');
  await transaction(this.#pool,async client=>{
   await locked(client,ref);
   const op=(await client.query<OperationRow>('SELECT * FROM data_lifecycle_operations WHERE venue_id=$1 AND operation_id=$2',[ref.venueId,operationId])).rows[0];
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(!op||op.claim_revision!==claimRevision||op.claim_lifecycle_revision!==ref.revision||op.lease_until===null||op.lease_until.getTime()<=now.getTime())fail('stale_lifecycle_claim');
   const prior=(await client.query('SELECT * FROM data_lifecycle_effects WHERE venue_id=$1 AND operation_id=$2 AND effect_id=$3',[ref.venueId,operationId,effect.effectId])).rows[0];
   const resource=effect.resourceReference??null;
   if(prior){
    if(prior.request_fingerprint!==effect.requestFingerprint||prior.resource_reference!==null&&prior.resource_reference!==resource)fail('lifecycle_conflict');
    if(prior.phase==='confirmed'||prior.phase==='refused'){
     if(prior.phase!==effect.phase||prior.resource_reference!==resource)fail('lifecycle_conflict');return;
    }
    if(effect.phase==='intent')fail('effect_uncertain');
    await client.query('UPDATE data_lifecycle_effects SET phase=$4,resource_reference=$5 WHERE venue_id=$1 AND operation_id=$2 AND effect_id=$3',
     [ref.venueId,operationId,effect.effectId,effect.phase,resource]);
   }else{
    if(effect.phase!=='intent')fail('lifecycle_conflict');
    if((await client.query("SELECT 1 FROM data_lifecycle_effects WHERE venue_id=$1 AND phase IN ('intent','uncertain')",[ref.venueId])).rowCount)fail('effect_uncertain');
    await client.query('INSERT INTO data_lifecycle_effects(venue_id,operation_id,effect_id,request_fingerprint,phase,resource_reference) VALUES($1,$2,$3,$4,$5,$6)',
     [ref.venueId,operationId,effect.effectId,effect.requestFingerprint,effect.phase,resource]);
   }
  });
 }
}
