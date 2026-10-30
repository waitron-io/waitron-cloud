import {transaction} from '../../packages/registration/src/transaction.ts';
import {readVenuePlan} from '../../packages/registration/src/organisation-plans.ts';
import {readVenuePermissions} from '../../packages/registration/src/venue-service-permissions.ts';
import {levelAllows} from '../../packages/registration/src/venue-service-rules.ts';
import {openStorageAuthority} from './storage-authority.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {request} from 'node:http';
import {bootstrapStorageIssuer} from './storage-issuer.mjs';
import {loadRuntime} from '../local-stack/runtime.mjs';
import {captureRuntime} from '../../packages/backups/src/capture-config.ts';

export function reloadTestStorage(directory){
 return new Promise((resolve,reject)=>{
  const req=request({socketPath:join(directory,'storage-authority/reload.sock'),path:'/reload',method:'POST'},res=>{res.resume();res.once('end',()=>res.statusCode===204?resolve():reject(Error('test_cloud.storage_reload')));});
  req.setTimeout(5000,()=>req.destroy(Error('test_cloud.storage_reload')));req.once('error',()=>reject(Error('test_cloud.storage_reload')));req.end();
 });
}
export async function testStorageOptions({pool,directory,reload=()=>reloadTestStorage(directory)}){
 const config=await loadRuntime(directory);
 return {pool,mode:'test-free-paid',directory:join(directory,'storage-authority/managed'),iamPath:join(directory,'storage-authority/iam.json'),admin:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey},endpoint:'https://waitron.local:8333',region:'local',ca:await readFile(join(directory,'lan/ca.pem'),'utf8'),reload};
}
export async function openTestCaptureRuntime({pool,mode,directory}){
 if(mode!=='test-free-paid')throw Error('test_cloud.plan_mode');
 await bootstrapStorageIssuer(directory);
 const config=await loadRuntime(directory),storage=await testStorageOptions({pool,directory});
 const managedStreams=await openPlanStorage(storage);
 const runtime=captureRuntime({CLOUD_BACKUP_MASTER_KEY:config.backup.masterKey,CLOUD_BACKUP_AUTHORITY:await readFile(join(directory,'storage-authority/issuer.json'),'utf8'),CLOUD_BACKUP_CA_FILE:join(directory,'lan/ca.pem'),CLOUD_BACKUP_ENDPOINT:storage.endpoint,CLOUD_BACKUP_REGION:storage.region,CLOUD_BACKUP_ACCESS_KEY:storage.admin.accessKeyId,CLOUD_BACKUP_SECRET_KEY:storage.admin.secretAccessKey});
 runtime.options.planMode=mode;runtime.options.managedStreams=managedStreams;return runtime;
}
export async function openRuntimeStorage({mode,...options}){
 if(!['existing','test-free-paid','test-venue-levels'].includes(mode))throw Error('test_cloud.plan_mode');
 return mode==='existing'?openStorageAuthority({...options,policyMode:mode}):openPlanStorage({...options,mode});
}

// Provider work runs without database locks. The final policy read checks the
// original mode and revision; a permission round trip must not revive an old writer.
export async function openPlanStorage({pool,mode,...options}){
 if(!['test-free-paid','test-venue-levels'].includes(mode))throw Error('test_cloud.plan_mode');
 async function policy(venueId){
  return transaction(pool,async client=>{
   if(mode==='test-venue-levels'){
    const permission=await readVenuePermissions(client,venueId,mode);
    if(!levelAllows(permission.level,'continuous_backup'))throw Error('permission_denied');
    return permission.revision;
   }
   if(await readVenuePlan(client,venueId,mode)!=='paid')throw Error('permission_denied');
   const row=(await client.query('SELECT o.service_plan_revision FROM organisations o JOIN venues v ON v.organisation_id=o.id WHERE v.id=$1',[venueId])).rows[0];
   if(!row)throw Error('permission_denied');return row.service_plan_revision;
  });
 }
 const authority=await openStorageAuthority({...options,policyMode:mode,authorizeWriter:async(id,revision,writerMode)=>{try{return writerMode===mode&&await policy(id)===revision;}catch(error){if(error?.message==='permission_denied')return false;throw error;}}});
 return {
  async provision(input){
   const revision=await policy(input.venueId),result=await authority.provision({...input,policyRevision:revision});
   try{if(await policy(input.venueId)!==revision)throw Error('permission_denied');return result;}
   catch(error){await authority.withdrawWriter(input.venueId,revision);throw error;}
  },
  async reader(input){await policy(input.venueId);const result=await authority.reader(input);await policy(input.venueId);return result;},
  read:(...args)=>authority.read(...args),
  withdrawWriter:(...args)=>authority.withdrawWriter(...args),
  reconcile:()=>authority.reconcile()
 };
}
