import type {Pool,PoolClient} from 'pg';
import {resolveCname} from 'node:dns/promises';
import {dnsInstructions,verifyDelegation,validateCsr} from './certificates.ts';
import {transaction} from '@waitron-cloud/registration';
import {isUuid,isHostname,isPeerKey,type GatewayManifest,type GatewayRoute} from './manifest.ts';
export interface CellInput {id:string;country:string;provider:string;environment:string;suffix:string;subnet:number;publicKey:string;endpoint:string}
export interface Placement extends GatewayRoute {cellId:string;gatewayPublicKey:string;endpoint:string}
function fail(code:string):never {throw new Error(code);}
async function placement(client:PoolClient,id:string):Promise<Placement|undefined>{
 const {rows}=await client.query(`SELECT p.installation_id AS "installationId",p.venue_id AS "venueId",p.cell_id AS "cellId",
  host(p.address) AS address,p.port,p.peer_public_key AS "peerPublicKey",c.public_key AS "gatewayPublicKey",c.endpoint,
  s.hostname AS "staffHostname",u.hostname AS "publicHostname"
  FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id
  JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
  JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public' WHERE p.installation_id=$1`,[id]);return rows[0];
}
/** Operator provisioning only. Customer calls must not choose cells, addresses or peer keys here. */
export class RemoteAccessStore {
 readonly #pool:Pool;
 constructor(pool:Pool){this.#pool=pool;}
 async createCell(c:CellInput){
  const endpoint=c.endpoint.split(':');
  if(!isUuid(c.id)||c.country!=='ES'||c.provider!=='aws'||!['test','production'].includes(c.environment)||!isHostname(c.suffix)||c.suffix.length>180
   ||!Number.isInteger(c.subnet)||c.subnet<0||c.subnet>255||!isPeerKey(c.publicKey)||endpoint.length!==2||!isHostname(endpoint[0])||!/^\d{1,5}$/.test(endpoint[1]!)||Number(endpoint[1])<1||Number(endpoint[1])>65535)fail('invalid_cell');
  await this.#pool.query(`INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.id,c.country,c.provider,c.environment,c.suffix,c.subnet,c.publicKey,c.endpoint]);
 }
 async provision(installationId:string,cellId:string,peerPublicKey:string,port=443):Promise<Placement>{
  if(!isUuid(installationId)||!isUuid(cellId)||!isPeerKey(peerPublicKey)||!Number.isInteger(port)||port<1||port>65535)fail('invalid_placement');
  try{return await transaction(this.#pool,async client=>{
   const install=(await client.query('SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i',[installationId])).rows[0];
   if(!install)fail('installation_unavailable');if(install.revoked_at)fail('revoked');
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR UPDATE',[cellId])).rows[0];
   if(!cell||cell.environment!==install.environment)fail('cell_unavailable');
   const prior=await placement(client,installationId);
   if(prior){if(prior.cellId!==cellId||prior.peerPublicKey!==peerPublicKey||prior.port!==port)fail('placement_conflict');return prior;}
   if(cell.next_address>=66)fail('cell_full');
   const address=`10.77.${cell.subnet}.${cell.next_address}`;
   await client.query('INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,$4,$5,$6)',[install.venue_id,installationId,cellId,address,peerPublicKey,port]);
   const stem=`v-${install.venue_id}`;
   await client.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES($1,$2,'staff'),($3,$2,'public')",[`staff-${stem}.${cell.suffix}`,install.venue_id,`${stem}.${cell.suffix}`]);
   await client.query('UPDATE remote_cells SET next_address=next_address+1 WHERE id=$1',[cellId]);
   const result=(await placement(client,installationId))!;
   await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access'",[installationId,{version:1,...result}]);
   await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[installationId]);return result;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return fail('placement_conflict');throw error;}
 }
 async #assigned(id:string,kind:'staff'|'public'){
  if(!isUuid(id)||!['staff','public'].includes(kind))fail('invalid_placement');
  const row=(await this.#pool.query(`SELECT p.venue_id,c.suffix,i.revoked_at FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id JOIN installations i ON i.id=p.installation_id WHERE i.id=$1`,[id])).rows[0];
  if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');return `${kind==='staff'?'staff-':''}v-${row.venue_id}.${row.suffix}`;
 }
 async hostnameInstructions(id:string,kind:'staff'|'public',custom:string){return dnsInstructions(custom,await this.#assigned(id,kind));}
 async setHostname(id:string,kind:'staff'|'public',custom:string,expectedRevision:number,resolve:typeof resolveCname=resolveCname,authorize?:(client:PoolClient)=>Promise<string>):Promise<Placement>{
  const assigned=await this.#assigned(id,kind);
  if(!isHostname(custom)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid_hostname');
  // The complete operator namespace is reserved, including names for venues not provisioned yet.
  if(custom!==assigned){
   if((await this.#pool.query("SELECT id FROM remote_cells WHERE $1=suffix OR right($1,length(suffix)+1)='.'||suffix",[custom])).rowCount)fail('hostname_conflict');
   await verifyDelegation(custom,assigned,resolve);
  }
  try{return await transaction(this.#pool,async client=>{
   const actor=await authorize?.(client);
   const row=(await client.query('SELECT * FROM installations WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');if(row.configuration_revision!==expectedRevision)fail('revision_conflict');
   // Assigned names are reserved even when a venue elects to use a custom name.
   const reserved=(await client.query(`SELECT p.installation_id FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id WHERE $1 IN ('staff-v-'||p.venue_id||'.'||c.suffix,'v-'||p.venue_id||'.'||c.suffix) AND p.installation_id<>$2`,[custom,id])).rowCount;
   if(reserved)fail('hostname_conflict');
   await client.query('UPDATE remote_hostnames SET hostname=$3 WHERE venue_id=$1 AND kind=$2',[row.venue_id,kind,custom]);
   const result=(await placement(client,id))!;
   await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access'",[id,{version:1,...result}]);
   await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[id]);
   if(authorize){await authorize(client);await client.query('INSERT INTO remote_hostname_changes(installation_id,account_id,kind,hostname,configuration_revision) VALUES($1,$2,$3,$4,$5)',[id,actor,kind,custom,expectedRevision+1]);}
   return result;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return fail('hostname_conflict');throw error;}
 }
 async authorizeCertificate(id:string,kind:'staff'|'public',csr:string){
  const assigned=await this.#assigned(id,kind);
  return transaction(this.#pool,async client=>{
   const row=(await client.query('SELECT revoked_at FROM installations WHERE id=$1 FOR SHARE',[id])).rows[0];if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');
   const p=(await placement(client,id))!;const hostname=kind==='staff'?p.staffHostname:p.publicHostname;validateCsr(csr,hostname);
   return {hostname,dnsName:'_acme-challenge.'+assigned};
  });
 }
 async manifest(cellId:string,now=Date.now()):Promise<GatewayManifest>{
  if(!isUuid(cellId))fail('invalid_cell');
  return transaction(this.#pool,async client=>{
   const cell=(await client.query('UPDATE remote_cells SET sequence=sequence+1 WHERE id=$1 RETURNING sequence',[cellId])).rows[0];if(!cell)fail('cell_unavailable');
   const ids=await client.query('SELECT p.installation_id FROM remote_placements p JOIN installations i ON i.id=p.installation_id WHERE p.cell_id=$1 AND i.revoked_at IS NULL ORDER BY p.venue_id',[cellId]);
   const routes:GatewayRoute[]=[];
   for(const row of ids.rows){const p=(await placement(client,row.installation_id))!;routes.push({installationId:p.installationId,venueId:p.venueId,staffHostname:p.staffHostname,publicHostname:p.publicHostname,address:p.address,port:p.port,peerPublicKey:p.peerPublicKey});}
   return {version:1,audience:'waitron-cloud-gateway',cellId,sequence:Number(cell.sequence),issuedAt:now,expiresAt:now+600000,routes};
  });
 }
}
