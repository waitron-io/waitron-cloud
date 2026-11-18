import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {CertificateAuthorization} from './placement.ts';
export function certificateDigest(installationId:string,kind:'staff'|'public',value:CertificateAuthorization,cells:string[]=[]){
 return createHash('sha256').update(JSON.stringify({installationId,kind,revision:value.revision,hostname:value.hostname,dnsName:value.dnsName,...(kind==='public'?{cells:[...cells].sort()}:{} )})).digest('hex');
}
export async function routeCells(client:PoolClient,installationId:string):Promise<string[]>{
 const result=await client.query(`SELECT p.cell_id FROM remote_placements p JOIN installations i ON i.id=p.installation_id WHERE p.installation_id=$1 AND i.revoked_at IS NULL
  UNION SELECT m.target_cell_id FROM remote_cell_moves m JOIN installations i ON i.id=m.installation_id
  WHERE m.installation_id=$1 AND m.state IN ('staged','ready') AND m.expected_revision=i.configuration_revision AND i.revoked_at IS NULL ORDER BY cell_id`,[installationId]);
 return result.rows.map(row=>row.cell_id);
}
