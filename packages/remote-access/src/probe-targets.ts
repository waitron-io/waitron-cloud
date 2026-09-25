import type {Pool} from 'pg';

export interface RemoteProbeTarget {
 installationId:string;
 venueId:string;
 revision:number;
 staffHostname:string;
 publicHostname:string;
}

interface TargetRow extends Omit<RemoteProbeTarget,'revision'> {revision:number|string}

export class RemoteProbeStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async targets(limit=100):Promise<RemoteProbeTarget[]> {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('invalid_probe_limit');
  const {rows}=await this.#pool.query<TargetRow>(`SELECT i.id AS "installationId",i.venue_id AS "venueId",
   i.configuration_revision AS revision,s.hostname AS "staffHostname",p.hostname AS "publicHostname"
   FROM installations i
   JOIN installation_services x ON x.installation_id=i.id AND x.service='remote_access' AND x.state<>'unconfigured'
   JOIN remote_placements r ON r.installation_id=i.id AND r.venue_id=i.venue_id
   JOIN remote_hostnames s ON s.venue_id=i.venue_id AND s.kind='staff'
   JOIN remote_hostnames p ON p.venue_id=i.venue_id AND p.kind='public'
   WHERE i.revoked_at IS NULL AND i.superseded_by IS NULL
   ORDER BY i.venue_id,i.id LIMIT $1`,[limit]);
  return rows.map(row=>{
   const revision=Number(row.revision);if(!Number.isSafeInteger(revision)||revision<0)throw new Error('invalid_probe_revision');
   return {...row,revision};
  });
 }
}
