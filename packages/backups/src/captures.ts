import type {Pool,PoolClient} from 'pg';
import {createLeaseTrust,InstallationStore,InstallationError,readMachineClaims,verifyMachine,verifyLease,readVenuePermissions,type VenuePermission,type LeaseIssuer,type PlanMode} from '@waitron-cloud/registration';
import {BackupCatalogue,backupFail,type ObjectFactory,type PointMetadata} from './catalogue.ts';
import type {BackupKeyVault} from './keys.ts';
import type {StorageLocation,StorageScope,StorageCredentials} from './storage.ts';
import type {ManagedStreamAuthority} from './managed-streams.ts';
export interface CaptureOptions {
 vault:BackupKeyVault;
 objects:ObjectFactory;
 grant(location:StorageLocation,scope:StorageScope):Promise<{credentials:StorageCredentials;expiresAt:string}>;
 planMode?:PlanMode;
 managedStreams?:ManagedStreamAuthority;
}
export type CaptureAction='backup-reserve'|'backup-publish';
export class BackupCaptures {
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #options:CaptureOptions;readonly #catalogue:BackupCatalogue;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,options:CaptureOptions,trusted=createLeaseTrust(issuer)){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;this.#options=options;this.#catalogue=new BackupCatalogue(pool,options.vault,options.objects,options.planMode);}
 async authenticate(action:CaptureAction,envelope:unknown){return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);}
 async execute(action:CaptureAction,envelope:unknown){
  if(this.#options.planMode==='test-free-paid'||this.#options.planMode==='test-venue-levels')await this.authenticate(action,envelope);
  const routing=readMachineClaims(envelope);
  let permission:VenuePermission|undefined;
  const fence=async(client:PoolClient)=>{
   // Catalogue callers hold the installation lock before the location lock; rechecking never reverses it.
   const row=(await client.query(`SELECT i.*,v.environment,s.state FROM installations i JOIN venues v ON v.id=i.venue_id
    JOIN installation_services s ON s.installation_id=i.id AND s.service='retained_snapshots' WHERE i.id=$1`,[routing.installationId])).rows[0];
   if(!row)throw new InstallationError('invalid_proof');
   const now=Date.now(),claims=verifyMachine(envelope,row.public_key,this.#origin,action,now);
   if(row.revoked_at)throw new InstallationError('revoked');
   if(row.environment!=='test'||row.state==='unconfigured')throw new InstallationError('permission_denied');
   let lease:unknown;try{lease=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(lease)!==claims.lease)throw new InstallationError('invalid_proof');
   const bound=verifyLease(lease,this.#trusted,this.#origin,now);
   if(bound.installationId!==row.id||bound.venueId!==row.venue_id||bound.environment!==row.environment||bound.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
   if(this.#options.planMode==='test-venue-levels'&&action==='backup-reserve'){
    // Catalogue admission already holds venue authority before the installation and location locks.
    const current=await readVenuePermissions(client,row.venue_id,this.#options.planMode);
    if(permission&&(current.revision!==permission.revision||current.organisationId!==permission.organisationId||current.legalBusinessId!==permission.legalBusinessId||current.venueId!==permission.venueId))backupFail('conflict');
    permission??=current;
   }
  };
  if(action==='backup-reserve'){
   if(routing.body!=='{}')backupFail('invalid_metadata');
   const capture=await this.#catalogue.reserveCapture(routing.installationId,routing.operationId,fence);
   const grant=await this.#options.grant(capture.location,{kind:'capture',bucket:capture.location.bucket,scope:capture.incomingKey});
   // Provider waits allow revocation to commit; never hand out the resulting grant without a fresh check.
   const current=await this.#catalogue.reserveCapture(routing.installationId,routing.operationId,fence);
   if(this.#options.planMode==='test-venue-levels'&&(current.location.endpoint!==capture.location.endpoint||current.location.bucket!==capture.location.bucket||current.location.region!==capture.location.region))backupFail('conflict');
   const expires=Date.parse(grant.expiresAt);
   if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+901000||!grant.credentials.accessKeyId||!grant.credentials.secretAccessKey||!grant.credentials.sessionToken)backupFail('storage_grant');
   return {id:current.id,installationId:routing.installationId,venueId:current.venueId,keyVersion:current.keyVersion,location:current.location,incomingKey:current.incomingKey,recoveryKey:current.keys.recoveryKey,...grant};
  }
  let metadata:PointMetadata;try{metadata=JSON.parse(routing.body);}catch{return backupFail('invalid_metadata');}
  const p=await this.#catalogue.publish(routing.installationId,routing.operationId,metadata,fence);
  return {id:p.id,installationId:p.installationId,venueId:p.venueId,keyVersion:p.keyVersion,digest:p.digest,size:p.size,capturedAt:p.capturedAt,retention:p.retention,sourceNodeId:p.sourceNodeId,modules:p.modules,verification:p.verification};
 }
}
