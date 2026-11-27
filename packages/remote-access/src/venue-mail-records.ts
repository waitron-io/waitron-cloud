import type {PoolClient} from 'pg';

export const venueMailDomain=(address:string)=>address.split('@')[1]!;
export const venueMailTarget=(selector:string,suffix:string)=>selector+'.mail.'+suffix;
export function venueMailAlias(domain:string,selector:string,suffix:string){
 return {type:'CNAME' as const,name:selector+'._domainkey.'+domain,value:venueMailTarget(selector,suffix)};
}

export async function hasActiveVenueMailInstallation(client:PoolClient,venueId:string,installationId?:string){
 const result=await client.query(`SELECT 1 FROM installations WHERE venue_id=$1 AND ($2::uuid IS NULL OR id=$2)
  AND revoked_at IS NULL AND superseded_by IS NULL FOR SHARE`,[venueId,installationId??null]);
 return Boolean(result.rowCount);
}
