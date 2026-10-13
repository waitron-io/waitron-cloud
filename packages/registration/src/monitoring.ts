import type {Pool,PoolClient} from 'pg';
import type {EmailOutbox} from './email-outbox.ts';
import type {IncidentKind,ServiceAlert} from './service-alert.ts';
import {validatedMonitorConfig} from './monitor-config.ts';
import {transaction} from './transaction.ts';
export interface MonitorConfig {probeStaleSeconds?:number;certificateWarningDays?:number;quietSeconds?:number;reminderSeconds?:number}
export class MonitorWorker {
 readonly #pool:Pool;readonly #outbox:EmailOutbox;readonly #probeStaleSeconds:number;readonly #certificateWarningDays:number;readonly #quietSeconds:number;readonly #reminderSeconds:number;
 constructor(pool:Pool,outbox:EmailOutbox,config:MonitorConfig={}){
  const options=validatedMonitorConfig(config);
  this.#pool=pool;this.#outbox=outbox;this.#probeStaleSeconds=options.probeStaleSeconds;this.#certificateWarningDays=options.certificateWarningDays;
  this.#quietSeconds=options.quietSeconds;this.#reminderSeconds=options.reminderSeconds;
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
   await this.#transition(client,installation.id,monitor.venue_id,'disconnected',!!active,!!active&&old(installation.last_contact_at??contactSince,900),now);
   await this.#transition(client,installation.id,monitor.venue_id,'snapshot_stale',!!snapshots,!!snapshots&&old(verified??snapshotSince!,172800),now);
   await this.#transition(client,installation.id,monitor.venue_id,'verification_failed',!!snapshots,!!failureSince&&old(failureSince,300),now);
   const remote=active&&services.includes('remote_access')?(await client.query('SELECT venue_id FROM remote_placements WHERE installation_id=$1 AND venue_id=$2',[installation.id,monitor.venue_id])).rows[0]:undefined;
   const observations=remote?(await client.query(`SELECT o.* FROM remote_probe_observations o JOIN remote_hostnames h ON h.venue_id=o.venue_id AND h.kind=o.service AND h.hostname=o.hostname
    WHERE o.installation_id=$1 AND o.venue_id=$2 AND o.configuration_revision=$3`,[installation.id,monitor.venue_id,installation.configuration_revision])).rows:[];
   for(const service of ['public','staff'] as const){
    const observation=observations.find(row=>row.service===service),fresh=!!observation&&!old(observation.checked_at,this.#probeStaleSeconds)&&observation.checked_at.getTime()<=now.getTime()+60000;
    const checkedAt=observation?.checked_at?.toISOString();
    await this.#transition(client,installation.id,monitor.venue_id,`${service}_route_failed`,!!remote&&fresh,!!remote&&fresh&&observation.status==='failed',now,checkedAt?{checkedAt}:{});
    await this.#transition(client,installation.id,monitor.venue_id,`${service}_probe_stale`,!!remote,!!remote&&!fresh,now,checkedAt?{checkedAt}:{});
    const certificate=!!remote&&observation?.certificate_not_after;
    const expiring=!!certificate&&certificate.getTime()<=now.getTime()+this.#certificateWarningDays*86400000;
    await this.#transition(client,installation.id,monitor.venue_id,`${service}_certificate_expiring`,!!certificate,expiring,now,certificate&&checkedAt?{checkedAt,certificateNotAfter:certificate.toISOString()}:{});
   }
   await client.query(`UPDATE venue_monitors SET checked_at=$2,next_check_at=LEAST($2::timestamptz+interval '1 minute',(SELECT min(e.opening_due_at) FROM venue_alert_episodes e JOIN venue_incidents i ON i.id=e.incident_id WHERE i.venue_id=$1 AND e.status='open' AND e.opening_processed_at IS NULL AND e.opening_due_at>$2)),contact_since=$3,snapshot_since=$4,failure_point_id=$5,failure_since=$6 WHERE venue_id=$1`,[monitor.venue_id,now,contactSince,snapshotSince,failurePoint,failureSince]);
   return true;
  });}catch(error){
   // A rolled-back venue retries later so another due venue can still be observed.
   if(retryVenue)try{await this.#pool.query("UPDATE venue_monitors SET next_check_at=clock_timestamp()+interval '30 seconds' WHERE venue_id=$1 AND next_check_at<=clock_timestamp()",[retryVenue]);}catch{/* Database recovery leaves the original due row available. */}
   throw error;
  }
 }
 async #transition(client:PoolClient,installationId:string,venueId:string,kind:IncidentKind,enabled:boolean,bad:boolean,now:Date,evidence:Pick<ServiceAlert,'checkedAt'|'certificateNotAfter'>={}){
  const previous=(await client.query('SELECT * FROM venue_incidents WHERE venue_id=$1 AND kind=$2',[venueId,kind])).rows[0];
  const status=!enabled?'suppressed':bad?'open':'recovered';
  if(!previous&&status!=='open')return;
  const changed=previous?.status!==status;
  const row=changed?(await client.query(`INSERT INTO venue_incidents(venue_id,kind,status,revision,opened_at,changed_at) VALUES($1,$2,$3,1,$4,$4)
   ON CONFLICT(venue_id,kind) DO UPDATE SET status=EXCLUDED.status,revision=venue_incidents.revision+1,
   opened_at=CASE WHEN EXCLUDED.status='open' THEN EXCLUDED.opened_at ELSE venue_incidents.opened_at END,changed_at=EXCLUDED.changed_at RETURNING *`,[venueId,kind,status,now])).rows[0]:previous;
  if(changed&&status==='open'){
   const episode=(await client.query(`INSERT INTO venue_alert_episodes(incident_id,installation_id,opening_revision,opened_at,quiet_seconds,reminder_seconds,opening_due_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$4::timestamptz+$5::integer*interval '1 second','open') RETURNING *`,[row.id,installationId,row.revision,row.opened_at,this.#quietSeconds,this.#reminderSeconds])).rows[0];
   const recipients=await this.#eligible(client,venueId,kind,installationId);
   for(let offset=0;offset<recipients.length;offset+=100){
    const accounts=recipients.slice(offset,offset+100).map(r=>r.id);
    await client.query(`INSERT INTO venue_alert_recipients(episode_id,account_id,reminder_status,recovery_status)
     SELECT $1,id,$3,'waiting' FROM unnest($2::uuid[]) id`,[episode.id,accounts,this.#reminderSeconds===0?'cancelled':'waiting']);
   }
  }
  const episode=(await client.query(`SELECT * FROM venue_alert_episodes WHERE incident_id=$1 AND opening_revision=$2 FOR UPDATE`,[row.id,status==='open'?row.revision:changed&&previous?.status==='open'?previous.revision:row.revision-1])).rows[0];
  if(!episode)return;
  if(changed&&status!=='open'){
   await client.query(`UPDATE venue_alert_episodes SET status=$2,recovery_revision=$3,opening_processed_at=COALESCE(opening_processed_at,$4),recovery_complete=$5 WHERE id=$1`,[episode.id,status,status==='recovered'?row.revision:null,now,status==='suppressed']);
   await client.query(`UPDATE venue_alert_recipients SET reminder_status=CASE WHEN reminder_status='waiting' THEN 'cancelled' ELSE reminder_status END,
    recovery_status=CASE WHEN $2='suppressed' AND recovery_status='waiting' THEN 'cancelled' ELSE recovery_status END WHERE episode_id=$1`,[episode.id,status]);
  }
  if(status==='open'&&episode.status==='open'&&episode.installation_id===installationId&&episode.opening_processed_at===null&&episode.opening_due_at<=now){
   const recipients=await this.#eligible(client,venueId,kind,installationId,episode.id);
   await this.#enqueue(client,row,episode.id,recipients,'open',evidence);
   await client.query('UPDATE venue_alert_episodes SET opening_processed_at=$2 WHERE id=$1',[episode.id,now]);
  }
  if(changed&&status==='recovered'&&previous?.status==='open'){
   const recipients=await this.#eligible(client,venueId,kind,episode.installation_id,episode.id);
   const told=(await client.query(`SELECT d.account_id FROM service_alert_deliveries d JOIN email_outbox e ON e.id=d.outbox_id
    WHERE d.episode_id=$1 AND d.state='open' AND d.notification='transition' AND e.status='sent'`,[episode.id])).rows.map(r=>r.account_id);
   const notified=recipients.filter(r=>told.includes(r.id));
   await this.#enqueue(client,row,episode.id,notified,'recovered',evidence);
   for(let offset=0;offset<notified.length;offset+=100)await client.query("UPDATE venue_alert_recipients SET recovery_status='queued' WHERE episode_id=$1 AND account_id=ANY($2::uuid[])",[episode.id,notified.slice(offset,offset+100).map(r=>r.id)]);
  }
 }
 async #eligible(client:PoolClient,venueId:string,kind:IncidentKind,installationId:string,episodeId?:string):Promise<{id:string;email:string;locale:'en'|'es'}[]>{
  return(await client.query(`SELECT a.id,c.email,p.locale FROM cloud_accounts a JOIN cloud_credentials c ON c.account_id=a.id
   JOIN account_alert_preferences p ON p.account_id=a.id JOIN organisation_memberships m ON m.account_id=a.id JOIN venues v ON v.organisation_id=m.organisation_id
   JOIN installations n ON n.venue_id=v.id AND n.id=$3
   WHERE v.id=$1 AND m.is_owner AND a.disabled_at IS NULL AND c.email_verified_at IS NOT NULL AND p.enabled
    AND v.environment='test' AND n.revoked_at IS NULL AND n.superseded_by IS NULL
    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM venue_alert_recipients r WHERE r.episode_id=$4 AND r.account_id=a.id))
    AND EXISTS(SELECT 1 FROM installation_services s WHERE s.installation_id=n.id AND s.state<>'unconfigured'
     AND ($2='disconnected' OR ($2 IN ('snapshot_stale','verification_failed') AND s.service='retained_snapshots')
      OR ($2 IN ('public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale','public_certificate_expiring','staff_certificate_expiring') AND s.service='remote_access'
       AND EXISTS(SELECT 1 FROM remote_placements rp JOIN remote_hostnames h ON h.venue_id=rp.venue_id WHERE rp.installation_id=n.id AND rp.venue_id=v.id
        AND h.kind=CASE WHEN $2 LIKE 'public_%' THEN 'public' ELSE 'staff' END)))) ORDER BY a.id`,[venueId,kind,installationId,episodeId??null])).rows;
 }
 async #enqueue(client:PoolClient,row:{id:string;revision:number;venue_id:string;kind:IncidentKind},episodeId:string,recipients:{id:string;email:string;locale:'en'|'es'}[],state:'open'|'recovered',evidence:Pick<ServiceAlert,'checkedAt'|'certificateNotAfter'>){
  for(let offset=0;offset<recipients.length;offset+=100){
   const batch=recipients.slice(offset,offset+100);
   const messages:ServiceAlert[]=batch.map(recipient=>({email:recipient.email,locale:recipient.locale,incidentId:row.id,revision:row.revision,venueId:row.venue_id,issue:row.kind,state,...evidence}));
   const outboxIds=await this.#outbox.enqueueServiceAlerts(client,messages);
   const parameters:unknown[]=[];
   const values=batch.map((recipient,index)=>{
    const base=index*6;parameters.push(outboxIds[index],row.id,row.revision,state,recipient.id,episodeId);
    return`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6})`;
   });
   await client.query(`INSERT INTO service_alert_deliveries(outbox_id,incident_id,revision,state,account_id,episode_id) VALUES ${values.join(',')}`,parameters);
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
