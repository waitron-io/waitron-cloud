import type {Pool,PoolClient} from 'pg';
import {resolveCname} from 'node:dns/promises';
import {dnsInstructions,verifyDelegation,validateCsr} from './certificates.ts';
import {requireRemotePlan,eligibleRemoteInstallations} from './plan-permissions.ts';
import {transaction,type PlanMode} from '@waitron-cloud/registration';
import {isUuid,isHostname,isPeerKey,type GatewayManifest,type GatewayRoute} from './manifest.ts';
export interface CellInput {id:string;country:string;provider:string;environment:string;suffix:string;subnet:number;publicKey:string;endpoint:string}
export interface Placement extends GatewayRoute {cellId:string;gatewayPublicKey:string;endpoint:string}
export interface CellMove {
 operationId:string;installationId:string;venueId:string;expectedRevision:number;
 state:'staged'|'ready'|'completed'|'cancelled';readinessSequence:number|null;revision:number|null;
 source:Placement;target:Placement;
}
export interface StageMoveInput {operationId:string;installationId:string;targetCellId:string;targetPeerPublicKey:string;port?:number;expectedRevision:number}
export interface CertificateAuthorization {hostname:string;dnsName:string;revision:number}
function fail(code:string):never {throw new Error(code);}
const route=(p:Placement):GatewayRoute=>({installationId:p.installationId,venueId:p.venueId,staffHostname:p.staffHostname,publicHostname:p.publicHostname,address:p.address,port:p.port,peerPublicKey:p.peerPublicKey});
// Peer keys are claimed in two tables, so both claim paths share this transaction lock.
async function lockPeerKey(client:PoolClient,key:string){await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);}
async function placement(client:PoolClient,id:string):Promise<Placement|undefined>{
 const {rows}=await client.query(`SELECT p.installation_id AS "installationId",p.venue_id AS "venueId",p.cell_id AS "cellId",
  host(p.address) AS address,p.port,p.peer_public_key AS "peerPublicKey",c.public_key AS "gatewayPublicKey",c.endpoint,
  s.hostname AS "staffHostname",u.hostname AS "publicHostname"
  FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id
  JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
  JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public' WHERE p.installation_id=$1`,[id]);return rows[0];
}
async function certificateAuthorization(client:PoolClient,id:string,kind:'staff'|'public',csr:string,lock:'share'|'update',mode:PlanMode):Promise<CertificateAuthorization>{
 await requireRemotePlan(client,id,mode);
 const row=(await client.query(`SELECT i.revoked_at,i.configuration_revision,p.venue_id,c.suffix,s.hostname AS staff_hostname,u.hostname AS public_hostname
  FROM installations i JOIN remote_placements p ON p.installation_id=i.id JOIN remote_cells c ON c.id=p.cell_id
  JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff' JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public'
  WHERE i.id=$1 FOR ${lock==='update'?'UPDATE':'SHARE'} OF i`,[id])).rows[0];
 if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');const hostname=kind==='staff'?row.staff_hostname:row.public_hostname;validateCsr(csr,hostname);
 return {hostname,dnsName:`_acme-challenge.${kind==='staff'?'staff-':''}v-${row.venue_id}.${row.suffix}`,revision:Number(row.configuration_revision)};
}
async function move(client:PoolClient,id:string,lock=false):Promise<CellMove|undefined>{
 const {rows}=await client.query(`SELECT m.id AS "operationId",m.installation_id AS "installationId",m.venue_id AS "venueId",
  m.expected_revision AS "expectedRevision",m.state,m.readiness_sequence AS "readinessSequence",m.completed_revision AS revision,
  m.source_cell_id AS "sourceCellId",host(m.source_address) AS "sourceAddress",m.source_peer_public_key AS "sourcePeerPublicKey",m.source_port AS "sourcePort",
  sc.public_key AS "sourceGatewayPublicKey",sc.endpoint AS "sourceEndpoint",
  m.target_cell_id AS "targetCellId",host(m.target_address) AS "targetAddress",m.target_peer_public_key AS "targetPeerPublicKey",m.target_port AS "targetPort",
  tc.public_key AS "targetGatewayPublicKey",tc.endpoint AS "targetEndpoint",s.hostname AS "staffHostname",u.hostname AS "publicHostname"
  FROM remote_cell_moves m JOIN remote_cells sc ON sc.id=m.source_cell_id JOIN remote_cells tc ON tc.id=m.target_cell_id
  JOIN remote_hostnames s ON s.venue_id=m.venue_id AND s.kind='staff' JOIN remote_hostnames u ON u.venue_id=m.venue_id AND u.kind='public'
  WHERE m.id=$1${lock?' FOR UPDATE OF m':''}`,[id]);
 const row=rows[0];if(!row)return;
 const common={installationId:row.installationId,venueId:row.venueId,staffHostname:row.staffHostname,publicHostname:row.publicHostname};
 return {operationId:row.operationId,installationId:row.installationId,venueId:row.venueId,expectedRevision:Number(row.expectedRevision),state:row.state,
  readinessSequence:row.readinessSequence===null?null:Number(row.readinessSequence),revision:row.revision===null?null:Number(row.revision),
  source:{...common,cellId:row.sourceCellId,address:row.sourceAddress,peerPublicKey:row.sourcePeerPublicKey,port:row.sourcePort,gatewayPublicKey:row.sourceGatewayPublicKey,endpoint:row.sourceEndpoint},
  target:{...common,cellId:row.targetCellId,address:row.targetAddress,peerPublicKey:row.targetPeerPublicKey,port:row.targetPort,gatewayPublicKey:row.targetGatewayPublicKey,endpoint:row.targetEndpoint}};
}
/** Operator provisioning only. Customer calls must not choose cells, addresses or peer keys here. */
export class RemoteAccessStore {
 readonly #pool:Pool;readonly #planMode:PlanMode;
 constructor(pool:Pool,planMode:PlanMode='existing'){this.#pool=pool;this.#planMode=planMode;}
 async createCell(c:CellInput){
  const endpoint=c.endpoint.split(':');
  if(!isUuid(c.id)||c.country!=='ES'||c.provider!=='aws'||!['test','production'].includes(c.environment)||!isHostname(c.suffix)||c.suffix.length>180
   ||!Number.isInteger(c.subnet)||c.subnet<0||c.subnet>255||!isPeerKey(c.publicKey)||endpoint.length!==2||!isHostname(endpoint[0])||!/^\d{1,5}$/.test(endpoint[1]!)||Number(endpoint[1])<1||Number(endpoint[1])>65535)fail('invalid_cell');
  await this.#pool.query(`INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[c.id,c.country,c.provider,c.environment,c.suffix,c.subnet,c.publicKey,c.endpoint]);
 }
 async provision(installationId:string,cellId:string,peerPublicKey:string,port=443):Promise<Placement>{
  if(!isUuid(installationId)||!isUuid(cellId)||!isPeerKey(peerPublicKey)||!Number.isInteger(port)||port<1||port>65535)fail('invalid_placement');
  try{return await transaction(this.#pool,async client=>{
   await requireRemotePlan(client,installationId,this.#planMode,false);
   const install=(await client.query('SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i',[installationId])).rows[0];
   if(!install)fail('installation_unavailable');if(install.revoked_at)fail('revoked');
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR UPDATE',[cellId])).rows[0];
   if(!cell||cell.environment!==install.environment)fail('cell_unavailable');
   const prior=await placement(client,installationId);
   if(prior){if(prior.cellId!==cellId||prior.peerPublicKey!==peerPublicKey||prior.port!==port)fail('placement_conflict');
    if(this.#planMode==='test-free-paid'){
     const restored=await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access' AND state='unconfigured' RETURNING 1",[installationId,{version:1,...prior}]);
     if(restored.rowCount)await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[installationId]);
    }return prior;}
   await lockPeerKey(client,peerPublicKey);
   if((await client.query("SELECT 1 FROM remote_cell_moves WHERE target_peer_public_key=$1 AND state IN ('staged','ready') LIMIT 1",[peerPublicKey])).rowCount)fail('placement_conflict');
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
 async stageMove(input:StageMoveInput):Promise<CellMove>{
  const port=input.port??443;
  if(!isUuid(input.operationId)||!isUuid(input.installationId)||!isUuid(input.targetCellId)||!isPeerKey(input.targetPeerPublicKey)||!Number.isInteger(port)||port<1||port>65535||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('invalid_move');
  try{return await transaction(this.#pool,async client=>{
   await requireRemotePlan(client,input.installationId,this.#planMode);
   const install=(await client.query('SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i',[input.installationId])).rows[0];
   if(!install)fail('installation_unavailable');
   const prior=await move(client,input.operationId,true);
   if(prior){if(prior.installationId!==input.installationId||prior.target.cellId!==input.targetCellId||prior.target.peerPublicKey!==input.targetPeerPublicKey||prior.target.port!==port||prior.expectedRevision!==input.expectedRevision)fail('move_conflict');return prior;}
   if(install.revoked_at)fail('revoked');if(install.configuration_revision!==input.expectedRevision)fail('revision_conflict');
   const source=await placement(client,input.installationId);if(!source)fail('installation_unavailable');if(source.cellId===input.targetCellId)fail('move_conflict');
   const cell=(await client.query('SELECT * FROM remote_cells WHERE id=$1 FOR UPDATE',[input.targetCellId])).rows[0];
   if(!cell||cell.environment!==install.environment)fail('cell_unavailable');if(cell.next_address>=66)fail('cell_full');
   await lockPeerKey(client,input.targetPeerPublicKey);
   const conflict=await client.query(`SELECT 1 FROM remote_placements WHERE peer_public_key=$1 AND installation_id<>$2
    UNION ALL SELECT 1 FROM remote_cell_moves WHERE target_peer_public_key=$1 AND id<>$3 AND state IN ('staged','ready') LIMIT 1`,[input.targetPeerPublicKey,input.installationId,input.operationId]);
   if(conflict.rowCount)fail('move_conflict');
   const active=await client.query("SELECT id FROM remote_cell_moves WHERE installation_id=$1 AND state IN ('staged','ready')",[input.installationId]);if(active.rowCount)fail('move_conflict');
   const address=`10.77.${cell.subnet}.${cell.next_address}`;
   await client.query(`INSERT INTO remote_cell_moves(id,installation_id,venue_id,expected_revision,source_cell_id,source_address,source_peer_public_key,source_port,
    target_cell_id,target_address,target_peer_public_key,target_port,minimum_target_sequence,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'staged')`,[input.operationId,input.installationId,source.venueId,input.expectedRevision,source.cellId,source.address,source.peerPublicKey,source.port,input.targetCellId,address,input.targetPeerPublicKey,port,Number(cell.sequence)+1]);
   await client.query('UPDATE remote_cells SET next_address=next_address+1 WHERE id=$1',[input.targetCellId]);return (await move(client,input.operationId))!;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return fail('move_conflict');throw error;}
 }
 async markMoveReady(operationId:string,expectedRevision:number,sequence:number):Promise<CellMove>{
  if(!isUuid(operationId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!Number.isSafeInteger(sequence)||sequence<1)fail('invalid_move');
  return transaction(this.#pool,async client=>{
   const found=(await client.query('SELECT installation_id FROM remote_cell_moves WHERE id=$1',[operationId])).rows[0];if(!found)fail('move_unavailable');
   await requireRemotePlan(client,found.installation_id,this.#planMode);
   const install=(await client.query('SELECT * FROM installations WHERE id=$1 FOR UPDATE',[found.installation_id])).rows[0],current=(await move(client,operationId,true))!;
   if(current.expectedRevision!==expectedRevision)fail('move_conflict');if(current.state==='completed')return current;if(current.state==='cancelled')fail('move_conflict');
   if(install.revoked_at)fail('revoked');if(install.configuration_revision!==expectedRevision)fail('revision_conflict');
   if(current.state==='ready'){if(current.readinessSequence!==sequence)fail('move_conflict');return current;}
   const cell=(await client.query('SELECT sequence FROM remote_cells WHERE id=$1 FOR SHARE',[current.target.cellId])).rows[0];
   const minimum=(await client.query('SELECT minimum_target_sequence FROM remote_cell_moves WHERE id=$1',[operationId])).rows[0].minimum_target_sequence;
   if(sequence<Number(minimum)||sequence>Number(cell.sequence))fail('move_not_exported');
   await client.query("UPDATE remote_cell_moves SET state='ready',readiness_sequence=$2,ready_at=clock_timestamp() WHERE id=$1",[operationId,sequence]);return (await move(client,operationId))!;
  });
 }
 async completeMove(operationId:string,expectedRevision:number):Promise<CellMove>{
  if(!isUuid(operationId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid_move');
  try{return await transaction(this.#pool,async client=>{
   const found=(await client.query('SELECT installation_id FROM remote_cell_moves WHERE id=$1',[operationId])).rows[0];if(!found)fail('move_unavailable');
   await requireRemotePlan(client,found.installation_id,this.#planMode);
   const install=(await client.query('SELECT * FROM installations WHERE id=$1 FOR UPDATE',[found.installation_id])).rows[0],current=(await move(client,operationId,true))!;
   if(current.expectedRevision!==expectedRevision)fail('move_conflict');if(current.state==='completed')return current;if(current.state==='cancelled')fail('move_conflict');if(current.state!=='ready')fail('move_not_ready');
   if(install.revoked_at)fail('revoked');if(install.configuration_revision!==expectedRevision)fail('revision_conflict');
   await client.query('UPDATE remote_placements SET cell_id=$2,address=$3,peer_public_key=$4,port=$5 WHERE installation_id=$1',[current.installationId,current.target.cellId,current.target.address,current.target.peerPublicKey,current.target.port]);
   const result=(await placement(client,current.installationId))!;
   await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access'",[current.installationId,{version:1,...result}]);
   await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[current.installationId]);
   await client.query("UPDATE remote_cell_moves SET state='completed',completed_revision=$2,completed_at=clock_timestamp() WHERE id=$1",[operationId,expectedRevision+1]);return (await move(client,operationId))!;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return fail('move_conflict');throw error;}
 }
 async cancelMove(operationId:string,expectedRevision:number):Promise<CellMove>{
  if(!isUuid(operationId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('invalid_move');
  return transaction(this.#pool,async client=>{
   const found=(await client.query('SELECT installation_id FROM remote_cell_moves WHERE id=$1',[operationId])).rows[0];if(!found)fail('move_unavailable');
   await client.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[found.installation_id]);const current=(await move(client,operationId,true))!;
   if(current.expectedRevision!==expectedRevision)fail('move_conflict');if(current.state==='cancelled')return current;if(current.state==='completed')fail('move_conflict');
   await client.query("UPDATE remote_cell_moves SET state='cancelled',cancelled_at=clock_timestamp() WHERE id=$1",[operationId]);return (await move(client,operationId))!;
  });
 }
 async #assigned(id:string,kind:'staff'|'public'){
  if(!isUuid(id)||!['staff','public'].includes(kind))fail('invalid_placement');
  return transaction(this.#pool,async client=>{
  await requireRemotePlan(client,id,this.#planMode);
  const row=(await client.query(`SELECT p.venue_id,c.suffix,i.revoked_at FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id JOIN installations i ON i.id=p.installation_id WHERE i.id=$1`,[id])).rows[0];
  if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');return `${kind==='staff'?'staff-':''}v-${row.venue_id}.${row.suffix}`;
  });
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
   await requireRemotePlan(client,id,this.#planMode);
   const row=(await client.query('SELECT * FROM installations WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row)fail('installation_unavailable');if(row.revoked_at)fail('revoked');if(row.configuration_revision!==expectedRevision)fail('revision_conflict');
   // Assigned names are reserved even when a venue elects to use a custom name.
   const reserved=(await client.query(`SELECT p.installation_id FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id WHERE $1 IN ('staff-v-'||p.venue_id||'.'||c.suffix,'v-'||p.venue_id||'.'||c.suffix) AND p.installation_id<>$2`,[custom,id])).rowCount;
   if(reserved)fail('hostname_conflict');
   await client.query('UPDATE remote_hostnames SET hostname=$3 WHERE venue_id=$1 AND kind=$2',[row.venue_id,kind,custom]);
   const result=(await placement(client,id))!;
   await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access'",[id,{version:1,...result}]);
   await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[id]);
   // Customer changes record the authenticated actor; operator calls have no customer session.
   if(authorize){await authorize(client);await client.query('INSERT INTO remote_hostname_changes(installation_id,account_id,kind,hostname,configuration_revision) VALUES($1,$2,$3,$4,$5)',[id,actor,kind,custom,expectedRevision+1]);}
   return result;
  });}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505')return fail('hostname_conflict');throw error;}
 }
 async authorizeCertificate(id:string,kind:'staff'|'public',csr:string){
  if(!isUuid(id)||!['staff','public'].includes(kind))fail('invalid_placement');
  return transaction(this.#pool,client=>certificateAuthorization(client,id,kind,csr,'share',this.#planMode));
 }
 async publishAuthorizedCertificate(client:PoolClient,id:string,kind:'staff'|'public',csr:string,expected:CertificateAuthorization,publish:()=>Promise<void>){
  if(!isUuid(id)||!['staff','public'].includes(kind))fail('invalid_placement');
  const current=await certificateAuthorization(client,id,kind,csr,'update',this.#planMode);
  if(JSON.stringify(current)!==JSON.stringify(expected))fail('placement_changed');await publish();return current;
 }
 async manifest(cellId:string,now=Date.now()):Promise<GatewayManifest>{
  if(!isUuid(cellId))fail('invalid_cell');
  return transaction(this.#pool,client=>this.#manifest(client,cellId,now));
 }
 async publishManifest(cellId:string,publish:(manifest:GatewayManifest)=>Promise<void>,now=Date.now()):Promise<void>{
  if(!isUuid(cellId))fail('invalid_cell');
  await transaction(this.#pool,async client=>{await publish(await this.#manifest(client,cellId,now));});
 }
 async #manifest(client:PoolClient,cellId:string,now:number):Promise<GatewayManifest>{
   const eligibleIds=await eligibleRemoteInstallations(client,this.#planMode,cellId);
   const eligible=eligibleIds===undefined?undefined:new Set(eligibleIds);
   const cell=(await client.query('UPDATE remote_cells SET sequence=sequence+1 WHERE id=$1 RETURNING sequence',[cellId])).rows[0];if(!cell)fail('cell_unavailable');
   const ids=await client.query('SELECT p.installation_id FROM remote_placements p JOIN installations i ON i.id=p.installation_id WHERE p.cell_id=$1 AND i.revoked_at IS NULL ORDER BY p.venue_id',[cellId]);
   const routes:GatewayRoute[]=[];
   for(const row of ids.rows){if(eligible&&!eligible.has(row.installation_id))continue;routes.push(route((await placement(client,row.installation_id))!));}
   const moves=await client.query(`SELECT m.id,m.installation_id FROM remote_cell_moves m JOIN installations i ON i.id=m.installation_id
    WHERE m.target_cell_id=$1 AND m.state IN ('staged','ready') AND i.configuration_revision=m.expected_revision AND i.revoked_at IS NULL ORDER BY m.venue_id`,[cellId]);
   for(const row of moves.rows){if(eligible&&!eligible.has(row.installation_id))continue;routes.push(route((await move(client,row.id))!.target));}routes.sort((a,b)=>a.venueId.localeCompare(b.venueId));
   return {version:1,audience:'waitron-cloud-gateway',cellId,sequence:Number(cell.sequence),issuedAt:now,expiresAt:now+600000,routes};
 }
}
