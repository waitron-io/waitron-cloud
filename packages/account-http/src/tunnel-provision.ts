import type {Pool,PoolClient} from 'pg';
import type {Context} from 'hono';
import {InstallationError,InstallationStore,createLeaseTrust,installationView,readMachineClaims,transaction,verifyLease,verifyMachine,
 type LeaseIssuer,type PlanMode,type SignedEnvelope} from '@waitron-cloud/registration';
import {RemoteAccessStore} from '@waitron-cloud/remote-access/placement';
import {isPeerKey,isUuid} from '@waitron-cloud/remote-access/manifest';
import {AccountHttpError} from './errors.ts';
import {readAccountBody} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export type TunnelProvisionOptions={installationId:string;cellId:string};
export class TunnelProvisionMachine{
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 readonly #trial:TunnelProvisionOptions;readonly #store:RemoteAccessStore;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trial:TunnelProvisionOptions,trusted=createLeaseTrust(issuer),planMode:PlanMode='existing'){
  if(!trial||!isUuid(trial.installationId)||!isUuid(trial.cellId))throw Error('invalid_tunnel_provision_configuration');
  this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;this.#trial={...trial};this.#store=new RemoteAccessStore(pool,planMode);
 }
 async authenticate(envelope:SignedEnvelope){
  const claims=await new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate('tunnel-provision',envelope);
  if(claims.installationId!==this.#trial.installationId)throw new InstallationError('permission_denied');
  return claims;
 }
 async #authorize(client:PoolClient,envelope:SignedEnvelope,venueId?:string){
  // Installation locks do not protect the venue's environment during allocation waits.
  const row=(await client.query(`SELECT i.*,v.environment,clock_timestamp() AS now FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`,[this.#trial.installationId])).rows[0];
  if(!row)throw new AccountHttpError(503,'temporarily_unavailable',1);
  if(venueId!==undefined&&row.venue_id!==venueId)throw new InstallationError('permission_denied');
  const claims=verifyMachine(envelope,row.public_key,this.#origin,'tunnel-provision',row.now.getTime());
  if(claims.installationId!==row.id)throw new InstallationError('invalid_proof');
  if(row.environment!=='test')throw new InstallationError('permission_denied');
  let lease:unknown;try{lease=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
  if(JSON.stringify(lease)!==claims.lease)throw new InstallationError('invalid_proof');
  const live=verifyLease(lease,this.#trusted,this.#origin,row.now.getTime());
  if(live.installationId!==row.id||live.venueId!==row.venue_id||live.environment!==row.environment||live.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
  return row;
 }
 async execute(envelope:SignedEnvelope){
  const claims=readMachineClaims(envelope);
  let body:unknown;try{body=JSON.parse(claims.body);}catch{throw new AccountHttpError(400,'invalid_input');}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).join(',')!=='peerPublicKey'
   ||!isPeerKey((body as {peerPublicKey:unknown}).peerPublicKey)||JSON.stringify(body)!==claims.body)throw new AccountHttpError(400,'invalid_input');
  try{return await transaction(this.#pool,async client=>{
   const initial=await this.#authorize(client,envelope);
   try{await this.#store.provisionInTransaction(client,this.#trial.installationId,this.#trial.cellId,(body as {peerPublicKey:string}).peerPublicKey,443);}
   catch(error){
    if(error instanceof Error&&error.message==='cell_unavailable')await this.#authorize(client,envelope,initial.venue_id);
    throw error;
   }
   const result=await installationView(client,this.#trial.installationId);
   await this.#authorize(client,envelope,initial.venue_id);
   return result;
  });}catch(error){
   if(error instanceof Error){
    if(error.message==='permission_denied'||error.message==='revoked')throw new AccountHttpError(403,error.message);
    if(error.message==='placement_conflict')throw new AccountHttpError(409,'placement_conflict');
    if(['cell_full','cell_unavailable','installation_unavailable'].includes(error.message))throw new AccountHttpError(503,'temporarily_unavailable',1);
   }throw error;
  }
 }
}
export async function tunnelProvisionResponse(c:Context,options:{machine?:TunnelProvisionMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable',1);
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']),signed={payload:envelope.payload!,signature:envelope.signature!};
 const claims=await options.machine.authenticate(signed);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 return c.json(await options.machine.execute(signed));
}
