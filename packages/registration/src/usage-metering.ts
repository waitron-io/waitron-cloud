import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';

export const usageEventTypes=[
 'backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes',
 'operation.installation_completed','operation.monitoring_probe',
 'message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled',
] as const;
export type UsageEventType=typeof usageEventTypes[number];
export const usageSourceKinds=['backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert'] as const;
export type UsageSourceKind=typeof usageSourceKinds[number];
export const usageReconciliationSourceNames=['backup_points','backup_recoveries','installation_operations','service_alerts'] as const;
export type UsageReconciliationSource=typeof usageReconciliationSourceNames[number];

export type UsageEventInput={
 organisationId:string;
 venueId:string|null;
 type:UsageEventType;
 quantity:bigint;
 sourceKind:UsageSourceKind;
 sourceReference:string;
 occurredAt:string;
};
export type UsageEventReceipt={id:string;occurredAt:string;recordedAt:string};
export type UsageReconciliationResult={
 acquired:boolean;
 sources:Partial<Record<UsageReconciliationSource,{recorded:number;caughtUp:boolean}>>;
};
export type UsageReconciliationStatus={sources:Array<{
 source:UsageReconciliationSource;
 lastAttemptedAt:string|null;
 caughtUpAt:string|null;
}>};
export type UsageSummary={
 version:1;organisationId:string;
 storage:{currentBytes:string;addedBytes:string;removedBytes:string};
 transfer:{uploadedBytes:string;restoredBytes:string};
 operations:{installationCompleted:string;monitoringProbes:string};
 messages:{sent:string;failed:string;expired:string;cancelled:string};
 latestEventAt:string|null;measuredThrough:string|null;
};

export class UsageError extends Error{
 readonly code:'invalid_input'|'permission_denied'|'usage_conflict';
 constructor(code:UsageError['code']){super(code);this.name='UsageError';this.code=code;}
}

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const sourceReference=/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
type UsageRow={
 id:string;organisation_id:string;venue_id:string|null;event_type:string;quantity:string;
 source_kind:string;source_reference:string;occurred_at:Date;recorded_at:Date;
};

function validTimestamp(value:string){
 if(typeof value!=='string')return false;
 const parsed=new Date(value);
 return Number.isFinite(parsed.getTime())&&parsed.toISOString()===value;
}
function validate(input:UsageEventInput){
 const expectedSource:Record<UsageEventType,UsageSourceKind>={
  'backup.storage_added_bytes':'backup_point','backup.storage_removed_bytes':'backup_point','backup.upload_bytes':'backup_point',
  'backup.restore_bytes':'backup_recovery','operation.installation_completed':'installation_operation',
  'operation.monitoring_probe':'monitoring_probe','message.service_alert_sent':'service_alert',
  'message.service_alert_failed':'service_alert','message.service_alert_expired':'service_alert','message.service_alert_cancelled':'service_alert',
 };
 if(!input||typeof input!=='object'||!uuid.test(input.organisationId)
  ||(input.venueId!==null&&!uuid.test(input.venueId))
  ||!(usageEventTypes as readonly string[]).includes(input.type)
  ||typeof input.quantity!=='bigint'||input.quantity<=0n
  ||!(usageSourceKinds as readonly string[]).includes(input.sourceKind)
  ||typeof input.sourceReference!=='string'||!sourceReference.test(input.sourceReference)
  ||!validTimestamp(input.occurredAt))throw new UsageError('invalid_input');
 if(expectedSource[input.type]!==input.sourceKind||(!input.type.startsWith('backup.')&&input.quantity!==1n))throw new UsageError('invalid_input');
}
function same(row:UsageRow,input:UsageEventInput){
 return row.organisation_id===input.organisationId&&row.venue_id===input.venueId
  &&row.event_type===input.type&&BigInt(row.quantity)===input.quantity
  &&row.source_kind===input.sourceKind&&row.source_reference===input.sourceReference
  &&row.occurred_at.toISOString()===input.occurredAt;
}
function receipt(row:UsageRow):UsageEventReceipt{
 return {id:row.id,occurredAt:row.occurred_at.toISOString(),recordedAt:row.recorded_at.toISOString()};
}

export async function recordUsageEvent(client:PoolClient,input:UsageEventInput):Promise<UsageEventReceipt>{
 validate(input);
 if(input.venueId){
  const venue=(await client.query<{organisation_id:string}>('SELECT organisation_id FROM venues WHERE id=$1',[input.venueId])).rows[0];
  if(!venue||venue.organisation_id!==input.organisationId)throw new UsageError('usage_conflict');
 }
 const values=[input.organisationId,input.venueId,input.type,input.quantity.toString(),input.sourceKind,input.sourceReference,input.occurredAt];
 const inserted=await client.query<UsageRow>(`INSERT INTO usage_events
  (organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at)
  VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,values);
 let row=inserted.rows[0];
 if(!row)row=(input.sourceKind==='service_alert'
  ?await client.query<UsageRow>('SELECT * FROM usage_events WHERE source_kind=$1 AND source_reference=$2 FOR SHARE',[input.sourceKind,input.sourceReference])
  :await client.query<UsageRow>('SELECT * FROM usage_events WHERE event_type=$1 AND source_kind=$2 AND source_reference=$3 FOR SHARE',[input.type,input.sourceKind,input.sourceReference])).rows[0];
 if(!row||!same(row,input))throw new UsageError('usage_conflict');
 return receipt(row);
}

type CandidateRow={
 organisation_id:string;venue_id:string|null;event_type:UsageEventType;quantity:string;
 source_kind:UsageSourceKind;source_reference:string;occurred_at:Date;
};
type SourceQuery={name:UsageReconciliationSource;sql:string};
const sources:SourceQuery[]=[
 {name:'backup_points',sql:`SELECT v.organisation_id,p.venue_id,e.event_type,p.size::text AS quantity,
   'backup_point'::text AS source_kind,p.id::text AS source_reference,e.occurred_at
  FROM backup_points p JOIN venues v ON v.id=p.venue_id
  CROSS JOIN LATERAL (VALUES
   ('backup.storage_added_bytes'::text,p.captured_at),
   ('backup.upload_bytes'::text,p.captured_at),
   ('backup.storage_removed_bytes'::text,p.deleted_at)
  ) e(event_type,occurred_at)
  WHERE p.kind='snapshot' AND e.occurred_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM usage_events u WHERE u.event_type=e.event_type
    AND u.source_kind='backup_point' AND u.source_reference=p.id::text)
  ORDER BY e.occurred_at,p.id,e.event_type LIMIT $1`},
 {name:'backup_recoveries',sql:`SELECT v.organisation_id,r.venue_id,'backup.restore_bytes'::text AS event_type,
   p.size::text AS quantity,'backup_recovery'::text AS source_kind,r.id::text AS source_reference,r.restored_at AS occurred_at
  FROM backup_recoveries r JOIN backup_points p ON p.id=r.point_id JOIN venues v ON v.id=r.venue_id
  WHERE r.source_kind='snapshot' AND r.restored_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM usage_events u WHERE u.event_type='backup.restore_bytes'
    AND u.source_kind='backup_recovery' AND u.source_reference=r.id::text)
  ORDER BY r.restored_at,r.id LIMIT $1`},
 {name:'installation_operations',sql:`SELECT v.organisation_id,i.venue_id,'operation.installation_completed'::text AS event_type,
   '1'::text AS quantity,'installation_operation'::text AS source_kind,
   i.id::text||':'||o.operation_id::text AS source_reference,o.created_at AS occurred_at
  FROM installation_operations o JOIN installations i ON i.id=o.installation_id JOIN venues v ON v.id=i.venue_id
  WHERE NOT EXISTS(SELECT 1 FROM usage_events u WHERE u.event_type='operation.installation_completed'
   AND u.source_kind='installation_operation' AND u.source_reference=i.id::text||':'||o.operation_id::text)
  ORDER BY o.created_at,i.id,o.operation_id LIMIT $1`},
 {name:'service_alerts',sql:`SELECT v.organisation_id,v.id AS venue_id,
   ('message.service_alert_'||e.status)::text AS event_type,'1'::text AS quantity,
   'service_alert'::text AS source_kind,e.id::text AS source_reference,e.finished_at AS occurred_at
  FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id
   JOIN venue_incidents i ON i.id=d.incident_id JOIN venues v ON v.id=i.venue_id
  WHERE e.status IN ('sent','failed','expired','cancelled') AND e.finished_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM usage_events u WHERE u.event_type='message.service_alert_'||e.status
    AND u.source_kind='service_alert' AND u.source_reference=e.id::text)
  ORDER BY e.finished_at,e.id LIMIT $1`},
];

function candidate(row:CandidateRow):UsageEventInput{
 return {organisationId:row.organisation_id,venueId:row.venue_id,type:row.event_type,
  quantity:BigInt(row.quantity),sourceKind:row.source_kind,sourceReference:row.source_reference,
  occurredAt:row.occurred_at.toISOString()};
}

export class UsageReconciler{
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async runOnce(limit=100):Promise<UsageReconciliationResult>{
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new UsageError('invalid_input');
  return transaction(this.#pool,async client=>{
   const locked=(await client.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtext(current_schema()),hashtext('cloud_usage_reconciliation')) AS locked")).rows[0]?.locked;
   if(!locked)return {acquired:false,sources:{}};
   const result:UsageReconciliationResult={acquired:true,sources:{}};
   for(const source of sources){
    const rows=(await client.query<CandidateRow>(source.sql,[limit])).rows;
    for(const row of rows)await recordUsageEvent(client,candidate(row));
    const caughtUp=rows.length<limit;
    await client.query(`UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),
     caught_up_at=CASE WHEN $2 THEN clock_timestamp() ELSE caught_up_at END WHERE source=$1`,[source.name,caughtUp]);
    result.sources[source.name]={recorded:rows.length,caughtUp};
   }
   return result;
  });
 }
 async status():Promise<UsageReconciliationStatus>{
  const rows=await this.#pool.query<{source:UsageReconciliationSource;last_attempted_at:Date|null;caught_up_at:Date|null}>(`SELECT source,last_attempted_at,caught_up_at
   FROM usage_reconciliation_sources ORDER BY CASE source
    WHEN 'backup_points' THEN 1 WHEN 'backup_recoveries' THEN 2 WHEN 'installation_operations' THEN 3 ELSE 4 END`);
  return {sources:rows.rows.map(row=>({source:row.source,lastAttemptedAt:row.last_attempted_at?.toISOString()??null,caughtUpAt:row.caught_up_at?.toISOString()??null}))};
 }
}

type SummaryRow={
 storage_added:string;storage_removed:string;uploaded:string;restored:string;
 installation_completed:string;monitoring_probes:string;messages_sent:string;
 messages_failed:string;messages_expired:string;messages_cancelled:string;latest_event_at:Date|null;
};
export class UsageStore{
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async summary(token:string,input:{organisationId:string}):Promise<UsageSummary>{
  if(!input||typeof input!=='object'||Object.keys(input).join(',')!=='organisationId'||!uuid.test(input.organisationId))throw new UsageError('invalid_input');
  return transaction(this.#pool,async client=>{
   const session=await resolveSession(client,token,{touch:false});
   const membership=await client.query(`SELECT account_id FROM organisation_memberships
    WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE`,[session.accountId,input.organisationId]);
   if(!membership.rowCount)throw new UsageError('permission_denied');
   const row=(await client.query<SummaryRow>(`SELECT
    COALESCE(sum(quantity) FILTER(WHERE event_type='backup.storage_added_bytes'),0)::text AS storage_added,
    COALESCE(sum(quantity) FILTER(WHERE event_type='backup.storage_removed_bytes'),0)::text AS storage_removed,
    COALESCE(sum(quantity) FILTER(WHERE event_type='backup.upload_bytes'),0)::text AS uploaded,
    COALESCE(sum(quantity) FILTER(WHERE event_type='backup.restore_bytes'),0)::text AS restored,
    COALESCE(sum(quantity) FILTER(WHERE event_type='operation.installation_completed'),0)::text AS installation_completed,
    COALESCE(sum(quantity) FILTER(WHERE event_type='operation.monitoring_probe'),0)::text AS monitoring_probes,
    COALESCE(sum(quantity) FILTER(WHERE event_type='message.service_alert_sent'),0)::text AS messages_sent,
    COALESCE(sum(quantity) FILTER(WHERE event_type='message.service_alert_failed'),0)::text AS messages_failed,
    COALESCE(sum(quantity) FILTER(WHERE event_type='message.service_alert_expired'),0)::text AS messages_expired,
    COALESCE(sum(quantity) FILTER(WHERE event_type='message.service_alert_cancelled'),0)::text AS messages_cancelled,
    max(occurred_at) AS latest_event_at FROM usage_events WHERE organisation_id=$1`,[input.organisationId])).rows[0]!;
   const freshness=(await client.query<{total:number;caught_up:number;measured_through:Date|null}>(`SELECT count(*)::integer AS total,
    count(caught_up_at)::integer AS caught_up,min(caught_up_at) AS measured_through FROM usage_reconciliation_sources`)).rows[0]!;
   await resolveSession(client,token,{touch:false});
   return {version:1 as const,organisationId:input.organisationId,
    storage:{currentBytes:(BigInt(row.storage_added)-BigInt(row.storage_removed)).toString(),addedBytes:row.storage_added,removedBytes:row.storage_removed},
    transfer:{uploadedBytes:row.uploaded,restoredBytes:row.restored},
    operations:{installationCompleted:row.installation_completed,monitoringProbes:row.monitoring_probes},
    messages:{sent:row.messages_sent,failed:row.messages_failed,expired:row.messages_expired,cancelled:row.messages_cancelled},
    latestEventAt:row.latest_event_at?.toISOString()??null,
    measuredThrough:freshness.total===usageReconciliationSourceNames.length&&freshness.caught_up===freshness.total
     ?freshness.measured_through?.toISOString()??null:null};
  });
 }
}
