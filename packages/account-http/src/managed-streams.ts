import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {createLeaseTrust,InstallationError,InstallationStore,readMachineClaims,verifyLease,verifyMachine,type LeaseIssuer} from '@waitron-cloud/registration';
import {ManagedStreams,type ManagedStreamInput,type ManagedStreamAuthority} from '@waitron-cloud/backups/managed-streams';
import type {BackupKeyVault} from '@waitron-cloud/backups/keys';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';

type StreamAction='backup-stream-configure'|'backup-stream-observe';
function object(value:unknown,keys:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
function invalid():never{throw new Error('backup.invalid_stream_configuration');}
function body(action:StreamAction,text:string):{revision:number;input:ManagedStreamInput}|undefined{
 let value:unknown;try{value=JSON.parse(text);}catch{return invalid();}
 if(JSON.stringify(value)!==text)return invalid();
 if(action==='backup-stream-observe'){if(text!=='{}')invalid();return;}
 if(!object(value,['revision','localVenueId','sourceNodeId','pointerSignerPublicKey'])||!Number.isSafeInteger(value.revision)||Number(value.revision)<0
  ||typeof value.localVenueId!=='string'||typeof value.sourceNodeId!=='string'||typeof value.pointerSignerPublicKey!=='string')invalid();
 return {revision:value.revision as number,input:{localVenueId:value.localVenueId,sourceNodeId:value.sourceNodeId,pointerSignerPublicKey:value.pointerSignerPublicKey}};
}
async function revision(pool:Pool,installationId:string){const row=(await pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installationId])).rows[0];if(!row)throw new InstallationError('unavailable');return Number(row.configuration_revision);}
export class ManagedStreamMachines{
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #streams:ManagedStreams;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,vault:BackupKeyVault,authority:ManagedStreamAuthority,trusted=createLeaseTrust(issuer)){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;this.#streams=new ManagedStreams(pool,vault,authority);}
 async authenticate(action:StreamAction,envelope:unknown){return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);}
 async execute(action:StreamAction,envelope:unknown){
  const routing=readMachineClaims(envelope),parsed=body(action,routing.body);
  const fence=async(client:PoolClient)=>{
   const row=(await client.query(`SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`,[routing.installationId])).rows[0];
   if(!row)throw new InstallationError('invalid_proof');
   const now=Date.now(),claims=verifyMachine(envelope,row.public_key,this.#origin,action,now);
   if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
   let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
   const lease=verifyLease(encoded,this.#trusted,this.#origin,now);
   if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==row.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
  };
  if(action==='backup-stream-configure')return this.#streams.configure(routing.installationId,parsed!.revision,parsed!.input,fence);
  const observed=await this.#streams.observe(routing.installationId,await revision(this.#pool,routing.installationId),fence);
  return {venueId:observed.venueId,installationId:observed.installationId,configurationRevision:observed.configurationRevision,localVenueId:observed.localVenueId,sourceNodeId:observed.sourceNodeId,recoverableAt:observed.recoverableAt,checkedAt:observed.checkedAt};
 }
}
export async function managedStreamResponse(c:Context,options:{streams?:ManagedStreamMachines;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.streams)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']),action=c.req.path.slice('/api/installations/'.length) as StreamAction;
 const claims=await options.streams.authenticate(action,envelope);await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.streams.execute(action,envelope));}
 catch(error){const code=error instanceof Error?error.message:'';const status:Record<string,400|403|409>={'backup.invalid_stream_configuration':400,'backup.invalid_stream_pointer':409,'backup.conflict':409,'backup.revoked':403,'backup.local_integration_only':403};if(status[code])throw new AccountHttpError(status[code],code.slice(7));throw error;}
}
