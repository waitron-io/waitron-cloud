import type {Pool} from 'pg';

export type OperationsState='ready'|'degraded'|'unready'|'unknown';
type Component={state:OperationsState;code:string};
type QueueCounts={pending:number;processing?:number;running?:number;sent?:number;expired?:number;cancelled?:number;failed:number;completed?:number};
export interface OperationsSnapshot{
 version:1;checkedAt:string;state:OperationsState;ready:boolean;
 components:{
  controlApi:Component&{live:boolean;ready:boolean;elapsedMs:number|null};
  monitoring:Component&{venues:number;due:number;unknown:number;incidents:number;oldestCheckAt:string|null};
  email:Component&{counts:QueueCounts;backlogged:number;oldestPendingAt:string|null};
  backups:Component&{counts:QueueCounts;due:number;oldestDueAt:string|null};
  remoteConfiguration:Component&{enabled:number;due:number;running:number;failed:number;oldestDueAt:string|null};
  gateways:Component&{expected:number;healthy:number;failed:number;stale:number;missing:number;oldestCheckAt:string|null};
  storage:Component&{expected:number;healthy:number;pending:number;failed:number;stale:number;missing:number;oldestVerifiedAt:string|null};
  usage:Component&{sources:number;stale:number;unknown:number;oldestCaughtUpAt:string|null};
 };
}
export interface OperationsStatusOptions{
 controlApiUrl:string;probeTimeoutMs?:number;queueWarningSeconds?:number;evidenceStaleSeconds?:number;
 snapshotStaleSeconds?:number;reconciliationStaleSeconds?:number;fetch?:typeof fetch;
}

function integer(value:number|undefined,fallback:number,max:number){const result=value??fallback;if(!Number.isInteger(result)||result<1||result>max)throw new Error('invalid_operations_configuration');return result;}
function iso(value:unknown){return value instanceof Date?value.toISOString():null;}
function controlOrigin(value:string){
 const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('invalid_operations_configuration');
 return url;
}
async function boundedBody(response:Response,limit=256){
 const length=response.headers.get('content-length');if(length!==null&&Number(length)>limit)throw new Error('body_too_large');
 if(!response.body)return '';
 const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(value){size+=value.byteLength;if(size>limit)throw new Error('body_too_large');parts.push(value);}}}
 finally{if(size>limit)await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(parts.map(part=>Buffer.from(part))).toString('utf8');
}
async function probe(url:URL,path:string,status:string,timeoutMs:number,request:typeof fetch){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs),started=performance.now();
 let response:Response|undefined;
 try{
  response=await request(new URL(path,url),{method:'GET',redirect:'manual',signal:controller.signal,headers:{accept:'application/json'}});
  if(response.status!==200)throw new Error('unexpected_status');
  const text=await boundedBody(response),body:unknown=JSON.parse(text);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='status'||(body as {status?:unknown}).status!==status)throw new Error('unexpected_body');
  return {ok:true as const,elapsedMs:Math.max(0,Math.round(performance.now()-started))};
 }catch{return {ok:false as const,elapsedMs:Math.max(0,Math.round(performance.now()-started))};}
 finally{clearTimeout(timer);controller.abort();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});}
}

export async function operationsStatus(pool:Pool,options:OperationsStatusOptions):Promise<OperationsSnapshot>{
 const origin=controlOrigin(options.controlApiUrl),probeTimeout=integer(options.probeTimeoutMs,2000,30000),queueWarning=integer(options.queueWarningSeconds,300,86400);
 const evidenceStale=integer(options.evidenceStaleSeconds,300,86400),snapshotStale=integer(options.snapshotStaleSeconds,172800,31_536_000),reconciliationStale=integer(options.reconciliationStaleSeconds,300,86400);
 const request=options.fetch??fetch;
 const [live,ready,monitor,email,backup,remote,gateway,storage,usage]=await Promise.all([
  probe(origin,'/api/health/live','live',probeTimeout,request),probe(origin,'/api/health/ready','ready',probeTimeout,request),
  pool.query(`SELECT count(*)::integer AS venues,count(*) FILTER(WHERE m.next_check_at<=clock_timestamp())::integer AS due,
   count(*) FILTER(WHERE m.checked_at IS NULL OR m.checked_at<=clock_timestamp()-$1*interval '1 second')::integer AS unknown,
   min(m.checked_at) AS oldest FROM(SELECT DISTINCT i.venue_id FROM installations i JOIN venues v ON v.id=i.venue_id
    WHERE v.environment='test' AND i.revoked_at IS NULL AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured'))targets
   LEFT JOIN venue_monitors m ON m.venue_id=targets.venue_id`,[evidenceStale]),
  pool.query(`SELECT status,count(*)::integer AS count,
   count(*) FILTER(WHERE status='pending' AND created_at<=clock_timestamp()-$1*interval '1 second'
    OR status='processing' AND lease_until<=clock_timestamp())::integer AS backlogged,
   min(created_at) FILTER(WHERE status IN('pending','processing')) AS oldest FROM email_outbox GROUP BY status`,[queueWarning]),
  pool.query(`SELECT status,count(*)::integer AS count,
   count(*) FILTER(WHERE status='pending' AND available_at<=clock_timestamp() OR status='running' AND lease_until<=clock_timestamp())::integer AS due,
   min(CASE WHEN status='running' THEN lease_until ELSE available_at END) FILTER(WHERE status='pending' AND available_at<=clock_timestamp() OR status='running' AND lease_until<=clock_timestamp()) AS oldest
   FROM backup_jobs GROUP BY status`),
  pool.query(`SELECT count(*) FILTER(WHERE enabled)::integer AS enabled,
   count(*) FILTER(WHERE enabled AND(status='pending' AND available_at<=clock_timestamp() OR status='running' AND lease_until<=clock_timestamp()))::integer AS due,
   count(*) FILTER(WHERE enabled AND status='running' AND lease_until>clock_timestamp())::integer AS running,
   count(*) FILTER(WHERE enabled AND status='failed')::integer AS failed,
   min(CASE WHEN status='running' THEN lease_until ELSE available_at END) FILTER(WHERE enabled AND(status='pending' AND available_at<=clock_timestamp() OR status='running' AND lease_until<=clock_timestamp())) AS oldest FROM remote_configuration_jobs`),
  pool.query(`SELECT count(*)::integer AS expected,
   count(*) FILTER(WHERE r.checked_at>clock_timestamp()-$1*interval '1 second' AND r.status='healthy')::integer AS healthy,
   count(*) FILTER(WHERE r.checked_at>clock_timestamp()-$1*interval '1 second' AND r.status='failed')::integer AS failed,
   count(*) FILTER(WHERE r.checked_at IS NOT NULL AND r.checked_at<=clock_timestamp()-$1*interval '1 second')::integer AS stale,
   count(*) FILTER(WHERE r.checked_at IS NULL)::integer AS missing,min(r.checked_at) AS oldest
   FROM installations i JOIN venues v ON v.id=i.venue_id JOIN remote_placements p ON p.installation_id=i.id AND p.venue_id=v.id
   JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' AND s.state<>'unconfigured'
   CROSS JOIN (VALUES('public'::text),('staff'::text)) service(kind)
   JOIN remote_hostnames h ON h.venue_id=v.id AND h.kind=service.kind
   LEFT JOIN remote_probe_observations r ON r.installation_id=i.id AND r.venue_id=v.id AND r.service=service.kind
    AND r.configuration_revision=i.configuration_revision AND r.hostname=h.hostname WHERE i.revoked_at IS NULL`,[evidenceStale]),
  pool.query(`SELECT count(*)::integer AS expected,
   count(*) FILTER(WHERE latest.verification='verified' AND latest.captured_at>clock_timestamp()-$1*interval '1 second')::integer AS healthy,
   count(*) FILTER(WHERE latest.verification='pending')::integer AS pending,
   count(*) FILTER(WHERE latest.verification='failed')::integer AS failed,
   count(*) FILTER(WHERE latest.verification='verified' AND latest.captured_at<=clock_timestamp()-$1*interval '1 second')::integer AS stale,
   count(*) FILTER(WHERE latest.id IS NULL)::integer AS missing,
   min(latest.captured_at) FILTER(WHERE latest.verification='verified') AS oldest
   FROM installations i JOIN installation_services s ON s.installation_id=i.id AND s.service='retained_snapshots' AND s.state<>'unconfigured'
   LEFT JOIN LATERAL(SELECT p.id,p.verification,p.captured_at FROM backup_points p WHERE p.installation_id=i.id AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL ORDER BY p.captured_at DESC,p.id DESC LIMIT 1)latest ON true
   WHERE i.revoked_at IS NULL`,[snapshotStale]),
  pool.query(`SELECT count(*)::integer AS sources,count(*) FILTER(WHERE caught_up_at IS NULL)::integer AS unknown,
   count(*) FILTER(WHERE caught_up_at IS NOT NULL AND caught_up_at<=clock_timestamp()-$1*interval '1 second')::integer AS stale,
   min(caught_up_at) AS oldest FROM usage_reconciliation_sources`,[reconciliationStale]),
 ]);
 const incidentCount=Number((await pool.query("SELECT count(*)::integer AS count FROM venue_incidents WHERE status='open'")).rows[0]?.count??0);
 const controlElapsed=Math.max(live.elapsedMs,ready.elapsedMs),controlApi={state:live.ok&&ready.ok?'ready' as const:'unready' as const,code:live.ok&&ready.ok?'ready':'unavailable',live:live.ok,ready:ready.ok,elapsedMs:Number.isFinite(controlElapsed)?controlElapsed:null};
 const m=monitor.rows[0],monitoring=incidentCount?{state:'degraded' as const,code:'incidents_open'}:m.venues===0?{state:'ready' as const,code:'no_targets'}:m.due||m.unknown?{state:'degraded' as const,code:m.unknown?'evidence_stale':'checks_due'}:{state:'ready' as const,code:'current'};
 const emailCounts:QueueCounts={pending:0,processing:0,sent:0,expired:0,cancelled:0,failed:0};let backlogged=0,oldestPendingAt:string|null=null;
 for(const row of email.rows){emailCounts[row.status as keyof QueueCounts]=row.count;backlogged+=row.backlogged;if(row.oldest&&(!oldestPendingAt||row.oldest.toISOString()<oldestPendingAt))oldestPendingAt=row.oldest.toISOString();}
 const emailState=email.rows.length===0?{state:'ready' as const,code:'empty'}:backlogged?{state:'degraded' as const,code:'delivery_backlog'}:{state:'ready' as const,code:'current'};
 const backupCounts:QueueCounts={pending:0,running:0,failed:0,completed:0};let backupDue=0,backupOldest:string|null=null;
 for(const row of backup.rows){backupCounts[row.status as keyof QueueCounts]=row.count;backupDue+=row.due;if(row.oldest&&(!backupOldest||row.oldest.toISOString()<backupOldest))backupOldest=row.oldest.toISOString();}
 const backupState=backupCounts.failed?{state:'unready' as const,code:'jobs_parked'}:backup.rows.length===0?{state:'ready' as const,code:'no_jobs'}:backupDue?{state:'degraded' as const,code:'jobs_due'}:{state:'ready' as const,code:'current'};
 const r=remote.rows[0],remoteState=r.failed?{state:'unready' as const,code:'jobs_parked'}:r.enabled===0?{state:'ready' as const,code:'no_targets'}:r.due?{state:'degraded' as const,code:'jobs_due'}:{state:'ready' as const,code:'current'};
 const g=gateway.rows[0],gatewayState=g.expected===0?{state:'ready' as const,code:'no_targets'}:g.missing?{state:'degraded' as const,code:'evidence_missing'}:g.stale?{state:'degraded' as const,code:'evidence_stale'}:g.failed?{state:'degraded' as const,code:'probe_failed'}:{state:'ready' as const,code:'current'};
 const s=storage.rows[0],storageState=s.expected===0?{state:'ready' as const,code:'no_targets'}:s.missing?{state:'degraded' as const,code:'snapshot_missing'}:s.failed?{state:'degraded' as const,code:'verification_failed'}:s.pending?{state:'degraded' as const,code:'verification_pending'}:s.stale?{state:'degraded' as const,code:'snapshot_stale'}:{state:'ready' as const,code:'current'};
 const u=usage.rows[0],usageState=u.unknown?{state:'degraded' as const,code:'unknown'}:u.stale?{state:'degraded' as const,code:'stale'}:{state:'ready' as const,code:'current'};
 const components:OperationsSnapshot['components']={
  controlApi,
  monitoring:{...monitoring,venues:m.venues,due:m.due,unknown:m.unknown,incidents:incidentCount,oldestCheckAt:iso(m.oldest)},
  email:{...emailState,counts:emailCounts,backlogged,oldestPendingAt},
  backups:{...backupState,counts:backupCounts,due:backupDue,oldestDueAt:backupOldest},
  remoteConfiguration:{...remoteState,enabled:r.enabled,due:r.due,running:r.running,failed:r.failed,oldestDueAt:iso(r.oldest)},
  gateways:{...gatewayState,expected:g.expected,healthy:g.healthy,failed:g.failed,stale:g.stale,missing:g.missing,oldestCheckAt:iso(g.oldest)},
  storage:{...storageState,expected:s.expected,healthy:s.healthy,pending:s.pending,failed:s.failed,stale:s.stale,missing:s.missing,oldestVerifiedAt:iso(s.oldest)},
  usage:{...usageState,sources:u.sources,stale:u.stale,unknown:u.unknown,oldestCaughtUpAt:iso(u.oldest)},
 };
 const states=Object.values(components).map(component=>component.state),state:OperationsState=states.includes('unready')?'unready':states.some(value=>value==='degraded'||value==='unknown')?'degraded':'ready';
 return {version:1,checkedAt:new Date().toISOString(),state,ready:state==='ready',components};
}
