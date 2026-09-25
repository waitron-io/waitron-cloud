import type {Pool,PoolClient} from 'pg';
import type {EmailOutbox} from './email-outbox.ts';
import {isNotifiableIncident,type IncidentKind} from './service-alert.ts';
import {transaction} from './transaction.ts';
export interface MonitorConfig {probeStaleSeconds?:number;certificateWarningDays?:number}
export class MonitorWorker {
 readonly #pool:Pool;readonly #outbox:EmailOutbox;readonly #probeStaleSeconds:number;readonly #certificateWarningDays:number;
 constructor(pool:Pool,outbox:EmailOutbox,config:MonitorConfig={}){
  this.#pool=pool;this.#outbox=outbox;this.#probeStaleSeconds=config.probeStaleSeconds??300;this.#certificateWarningDays=config.certificateWarningDays??30;
  if(!Number.isInteger(this.#probeStaleSeconds)||this.#probeStaleSeconds<1||this.#probeStaleSeconds>86400||!Number.isInteger(this.#certificateWarningDays)||this.#certificateWarningDays<1||this.#certificateWarningDays>3650)throw new Error('invalid_monitor_config');
 }
 async schedule(){
  const result=await this.#pool.query(`INSERT INTO venue_monitors(venue_id)
   SELECT i.venue_id FROM installations i JOIN venues v ON v.id=i.venue_id
   WHERE v.environment='test' AND i.revoked_at IS NULL
    AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=i.id AND s.state<>'unconfigured')
    AND NOT EXISTS(SELECT 1 FROM venue_monitors m WHERE m.venue_id=i.venue_id)
   ORDER BY i.venue_id LIMIT 100 ON CONFLICT DO NOTHING`);return result.rowCount??0;
 }
 async runOnce(){
  let retryVenue:string|undefined;
  try{return await transaction(this.#pool,async client=>{
   const monitor=(await client.query('SELECT * FROM venue_monitors WHERE next_check_at<=clock_timestamp() ORDER BY next_check_at,venue_id LIMIT 1 FOR UPDATE SKIP LOCKED')).rows[0];
   if(!monitor)return false;retryVenue=monitor.venue_id;
   // Lifecycle configuration and revocation take this installation lock before changing services.
   const installation=(await client.query(`SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.venue_id=$1 AND i.superseded_by IS NULL FOR SHARE OF i SKIP LOCKED`,[monitor.venue_id])).rows[0];
   if(!installation){
    await client.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()+interval '30 seconds' WHERE venue_id=$1",[monitor.venue_id]);
    return true;
   }
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   const services=(await client.query("SELECT service FROM installation_services WHERE installation_id=$1 AND state<>'unconfigured'",[installation?.id])).rows.map(r=>r.service);
   const active=installation&&installation.environment==='test'&&!installation.revoked_at&&services.length>0;
   const snapshots=active&&services.includes('retained_snapshots');
   const contactSince:Date|null=active?(monitor.contact_since??now):null;
   const snapshotSince:Date|null=snapshots?(monitor.snapshot_since??now):null;
   const latest=snapshots?(await client.query("SELECT id,verification FROM backup_points WHERE venue_id=$1 AND kind='snapshot' AND NOT deleting AND deleted_at IS NULL ORDER BY captured_at DESC,id DESC LIMIT 1",[monitor.venue_id])).rows[0]:undefined;
   const verified:Date|undefined=snapshots?(await client.query("SELECT max(captured_at) AS captured_at FROM backup_points WHERE venue_id=$1 AND kind='snapshot' AND verification='verified' AND NOT deleting AND deleted_at IS NULL",[monitor.venue_id])).rows[0].captured_at:undefined;
   const failurePoint=latest?.verification==='failed'?latest.id:null;
   const failureSince:Date|null=failurePoint?(monitor.failure_point_id===failurePoint?monitor.failure_since??now:now):null;
   const old=(date:Date,seconds:number)=>now.getTime()-date.getTime()>=seconds*1000;
   await this.#transition(client,monitor.venue_id,'disconnected',!!active,!!active&&old(installation.last_contact_at??contactSince,900),now);
   await this.#transition(client,monitor.venue_id,'snapshot_stale',!!snapshots,!!snapshots&&old(verified??snapshotSince!,172800),now);
   await this.#transition(client,monitor.venue_id,'verification_failed',!!snapshots,!!failureSince&&old(failureSince,300),now);
   const remote=active&&services.includes('remote_access')?(await client.query('SELECT venue_id FROM remote_placements WHERE installation_id=$1 AND venue_id=$2',[installation.id,monitor.venue_id])).rows[0]:undefined;
   const observations=remote?(await client.query(`SELECT o.* FROM remote_probe_observations o JOIN remote_hostnames h ON h.venue_id=o.venue_id AND h.kind=o.service AND h.hostname=o.hostname
    WHERE o.installation_id=$1 AND o.venue_id=$2 AND o.configuration_revision=$3`,[installation.id,monitor.venue_id,installation.configuration_revision])).rows:[];
   for(const service of ['public','staff'] as const){
    const observation=observations.find(row=>row.service===service),fresh=!!observation&&!old(observation.checked_at,this.#probeStaleSeconds)&&observation.checked_at.getTime()<=now.getTime()+60000;
    const checkedAt=observation?.checked_at?.toISOString();
    await this.#transition(client,monitor.venue_id,`${service}_route_failed`,!!remote&&fresh,!!remote&&fresh&&observation.status==='failed',now,checkedAt?{checkedAt}:{});
    await this.#transition(client,monitor.venue_id,`${service}_probe_stale`,!!remote,!!remote&&!fresh,now,checkedAt?{checkedAt}:{});
    const certificate=!!remote&&observation?.certificate_not_after;
    const expiring=!!certificate&&certificate.getTime()<=now.getTime()+this.#certificateWarningDays*86400000;
    await this.#transition(client,monitor.venue_id,`${service}_certificate_expiring`,!!certificate,expiring,now,certificate&&checkedAt?{checkedAt,certificateNotAfter:certificate.toISOString()}:{});
   }
   await client.query(`UPDATE venue_monitors SET checked_at=$2,next_check_at=$2::timestamptz+interval '1 minute',contact_since=$3,snapshot_since=$4,failure_point_id=$5,failure_since=$6 WHERE venue_id=$1`,[monitor.venue_id,now,contactSince,snapshotSince,failurePoint,failureSince]);
   return true;
  });}catch(error){
   // A rolled-back venue retries later so another due venue can still be observed.
   if(retryVenue)try{await this.#pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()+interval '30 seconds' WHERE venue_id=$1 AND next_check_at<=clock_timestamp()",[retryVenue]);}catch{/* Database recovery leaves the original due row available. */}
   throw error;
  }
 }
 async #transition(client:PoolClient,venueId:string,kind:IncidentKind,enabled:boolean,bad:boolean,now:Date,evidence:Pick<import('./service-alert.ts').ServiceAlert,'checkedAt'|'certificateNotAfter'>={}){
  const previous=(await client.query('SELECT * FROM venue_incidents WHERE venue_id=$1 AND kind=$2',[venueId,kind])).rows[0];
  const status=!enabled?'suppressed':bad?'open':'recovered';
  if(!previous&&status!=='open'||previous?.status===status)return;
  const row=(await client.query(`INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,$2,$3,1,$4,$4)
   ON CONFLICT(venue_id,kind) DO UPDATE SET status=EXCLUDED.status,revision=venue_incidents.revision+1,
   opened_at=CASE WHEN EXCLUDED.status='open' THEN EXCLUDED.opened_at ELSE venue_incidents.opened_at END,changed_at=EXCLUDED.changed_at RETURNING *`,[venueId,kind,status,now])).rows[0];
  if(status==='suppressed'||(status==='recovered'&&previous?.status!=='open'))return;
  if(!isNotifiableIncident(kind))throw new Error('incident_not_notifiable');
  const recipients=await client.query(`SELECT a.id,c.email,p.locale FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id
   JOIN account_alert_preferences p ON p.account_id=a.id JOIN organisation_memberships m ON m.account_id=a.id JOIN venues v ON v.organisation_id=m.organisation_id
   WHERE v.id=$1 AND m.is_owner AND a.disabled_at IS NULL AND c.email_verified_at IS NOT NULL AND p.enabled
   AND ($2='open' OR EXISTS(SELECT 1 FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id
    WHERE d.incident_id=$3 AND d.revision=$4 AND d.account_id=a.id AND d.state='open' AND e.status='sent'))`,[venueId,status,row.id,previous?.revision??0]);
  for(const recipient of recipients.rows){
   const outboxId=await this.#outbox.enqueue(client,'service_alert',{email:recipient.email,locale:recipient.locale,incidentId:row.id,revision:row.revision,venueId,issue:kind,state:status,...evidence});
   await client.query('INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id) VALUES($1,$2,$3,$4,$5)',[outboxId,row.id,row.revision,status,recipient.id]);
  }
 }
 async status(){return monitorStatus(this.#pool);}
}
export async function monitorStatus(pool:Pool){
 const row=(await pool.query(`SELECT count(*)::integer AS venues,count(*) FILTER(WHERE next_check_at<=clock_timestamp())::integer AS due,
  count(*) FILTER(WHERE checked_at IS NULL OR checked_at<=clock_timestamp()-interval '5 minutes')::integer AS unknown,min(checked_at) AS oldest_check_at FROM venue_monitors`)).rows[0];
 const incidents=(await pool.query("SELECT count(*)::integer AS count FROM venue_incidents WHERE status='open'")).rows[0].count;
 return {venues:row.venues,due:row.due,unknown:row.unknown,incidents,oldestCheckAt:row.oldest_check_at?.toISOString()??null};
}
