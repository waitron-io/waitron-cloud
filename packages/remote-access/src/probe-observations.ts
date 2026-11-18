import type {Pool,PoolClient} from 'pg';
import {recordUsageEvent,transaction} from '@waitron-cloud/registration';
import type {ProbeFailure,ProbeServiceResult,RemoteProbeResult} from './probe.ts';

const failures=new Set<ProbeFailure>(['dns','address_forbidden','timeout','tls','challenge','http','response_limit','cancelled']);
function date(value:string){const parsed=new Date(value);if(!Number.isFinite(parsed.getTime())||parsed.toISOString()!==value)throw new Error('invalid_probe_result');return parsed;}
function validate(result:RemoteProbeResult){
 if(result.version!==1||!Number.isSafeInteger(result.revision)||result.revision<0)throw new Error('invalid_probe_result');
 date(result.checkedAt);
 for(const service of [result.public,result.staff]){
  date(service.checkedAt);if(!Number.isInteger(service.elapsedMs)||service.elapsedMs<0||service.elapsedMs>2147483647)throw new Error('invalid_probe_result');
  if(service.status==='failed'){if(!failures.has(service.failure))throw new Error('invalid_probe_result');}
  else{date(service.certificate.notBefore);date(service.certificate.notAfter);if(!/^(?:[0-9A-F]{2}:)*[0-9A-F]{2}$/.test(service.certificate.fingerprint256))throw new Error('invalid_probe_result');}
 }
}
async function write(client:PoolClient,result:RemoteProbeResult,organisationId:string,service:'public'|'staff',value:ProbeServiceResult){
 const hostname=service==='public'?result.publicHostname:result.staffHostname,checkedAt=date(value.checkedAt),healthy=value.status==='healthy';
 const certificate=healthy?value.certificate:undefined,failure=healthy?null:value.failure;
 const recorded=await client.query(`INSERT INTO remote_probe_observations
  (installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure,
   certificate_not_before,certificate_not_after,certificate_fingerprint256,last_success_at,last_failure_at,last_failure)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  ON CONFLICT(installation_id,service) DO UPDATE SET
   venue_id=EXCLUDED.venue_id,configuration_revision=EXCLUDED.configuration_revision,hostname=EXCLUDED.hostname,
   status=EXCLUDED.status,checked_at=EXCLUDED.checked_at,elapsed_ms=EXCLUDED.elapsed_ms,failure=EXCLUDED.failure,
   certificate_not_before=COALESCE(EXCLUDED.certificate_not_before,remote_probe_observations.certificate_not_before),
   certificate_not_after=COALESCE(EXCLUDED.certificate_not_after,remote_probe_observations.certificate_not_after),
   certificate_fingerprint256=COALESCE(EXCLUDED.certificate_fingerprint256,remote_probe_observations.certificate_fingerprint256),
   last_success_at=COALESCE(EXCLUDED.last_success_at,remote_probe_observations.last_success_at),
   last_failure_at=COALESCE(EXCLUDED.last_failure_at,remote_probe_observations.last_failure_at),
   last_failure=COALESCE(EXCLUDED.last_failure,remote_probe_observations.last_failure)
  WHERE remote_probe_observations.checked_at<EXCLUDED.checked_at`,[
   result.installationId,result.venueId,service,result.revision,hostname,value.status,checkedAt,value.elapsedMs,failure,
   certificate?date(certificate.notBefore):null,certificate?date(certificate.notAfter):null,certificate?.fingerprint256??null,
   healthy?checkedAt:null,healthy?null:checkedAt,healthy?null:value.failure]);
 if(!recorded.rowCount)return false;
 await recordUsageEvent(client,{organisationId,venueId:result.venueId,type:'operation.monitoring_probe',quantity:1n,
  sourceKind:'monitoring_probe',sourceReference:`${result.installationId}:${service}:${value.checkedAt}`,occurredAt:value.checkedAt});
 return true;
}

export class RemoteProbeObservationStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async record(result:RemoteProbeResult):Promise<boolean>{
  validate(result);
  try{return await transaction(this.#pool,async client=>{
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if([result.checkedAt,result.public.checkedAt,result.staff.checkedAt].some(value=>date(value).getTime()>now.getTime()+60000))throw new Error('invalid_probe_result');
   // Configuration, hostname changes and revocation take this installation lock exclusively.
   const current=(await client.query(`SELECT i.configuration_revision,v.organisation_id,s.hostname AS staff_hostname,u.hostname AS public_hostname
    FROM installations i JOIN remote_placements p ON p.installation_id=i.id AND p.venue_id=i.venue_id
    JOIN venues v ON v.id=i.venue_id
    JOIN remote_hostnames s ON s.venue_id=i.venue_id AND s.kind='staff'
    JOIN remote_hostnames u ON u.venue_id=i.venue_id AND u.kind='public'
    WHERE i.id=$1 AND i.venue_id=$2 AND i.revoked_at IS NULL AND i.superseded_by IS NULL FOR SHARE OF i`,[result.installationId,result.venueId])).rows[0];
   if(!current||Number(current.configuration_revision)!==result.revision||current.staff_hostname!==result.staffHostname||current.public_hostname!==result.publicHostname)return false;
   const publicWritten=await write(client,result,current.organisation_id,'public',result.public);
   const staffWritten=await write(client,result,current.organisation_id,'staff',result.staff);
   return publicWritten||staffWritten;
  });}catch(error){
   // A placement change can hold the installation lock past this worker's statement bound.
   if(error&&typeof error==='object'&&'code' in error&&error.code==='57014')return false;
   throw error;
  }
 }
}
