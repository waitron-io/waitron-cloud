import {randomBytes,randomUUID} from 'node:crypto';
import {lstat,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createLeaseTrust} from '../../packages/registration/src/installation-proof.ts';
import {RelayKeys} from '../../packages/registration/src/relay-payload.ts';
import {RelayWorker} from '../../packages/registration/src/relay-worker.ts';
import {claimLease} from '../local-stack/lease.mjs';
import {canonicalHttpsOrigin} from '../local-stack/runtime.mjs';
import {testRelaySettings} from './relay-settings.mjs';

const purposes=['payload','replay','suppression','bounds'];
async function readKeys(path){
 let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return;throw error;}
 try{
  if(!info.isFile()||(info.mode&0o777)!==0o600||info.size>16384)throw Error();
  const keys=JSON.parse(await readFile(path,'utf8'));
  if(keys.version!==1)throw Error();
  for(const purpose of purposes)new RelayKeys(keys[purpose]);
  return keys;
 }catch{throw Error('test_cloud.relay_keys');}
}
async function loadKeys(pool,directory){
 const path=join(directory,'relay-keys.json'),existing=await readKeys(path);if(existing)return existing;
 let lease;for(let n=0;n<200&&!lease;n++){lease=await claimLease(join(directory,'.bootstrap.lock'));if(!lease)await new Promise(resolve=>setTimeout(resolve,25));}
 if(!lease)throw Error('test_cloud.relay_keys');
 const temporary=join(directory,'.relay-keys-'+randomUUID());
 try{
  const found=await readKeys(path);if(found)return found;
  // A database-only restore cannot replace keys that protect its ciphertext and replay history.
  const history=await pool.query(`SELECT EXISTS(SELECT 1 FROM relay_messages)
   OR EXISTS(SELECT 1 FROM relay_reservations) OR EXISTS(SELECT 1 FROM relay_suppressions)
   OR EXISTS(SELECT 1 FROM relay_bounds_windows) OR EXISTS(SELECT 1 FROM relay_bounds_policy) AS present`);
  if(history.rows[0].present)throw Error('test_cloud.relay_keys');
  const keys={version:1};for(const purpose of purposes)keys[purpose]={activeKeyId:'local-v1',keys:{'local-v1':randomBytes(32).toString('hex')}};
  await writeFile(temporary,JSON.stringify(keys),{mode:0o600});await lease.assertOwned();await rename(temporary,path);return keys;
 }finally{await rm(temporary,{force:true});await lease.release();}
}
export function testRelayGrantConfig({issuer,origin}){
 canonicalHttpsOrigin(origin);
 return {mode:'local-proof',...testRelaySettings,testOrigin:{environment:'test',origin,trusted:createLeaseTrust(issuer)},
  verifyOrigin:async()=>{throw Error('origin_unverified');}};
}
export async function openTestRelayRuntime({pool,directory,issuer,origin,mode,smtpPort=1025}){
 if(mode!=='test-venue-levels')return;
 const keys=await loadKeys(pool,directory),grants=testRelayGrantConfig({issuer,origin});
 const admission={mode:'local-proof',grants,payloadKeys:keys.payload,replayKeys:keys.replay,
  bounds:{version:'local-v1',epoch:testRelaySettings.policy.epoch,windowSeconds:3600,recipientLimit:100,grantLimit:100,queuedPayloadBytes:1000000,maxCounterRows:1000,recipientKeys:keys.bounds}};
 const worker=new RelayWorker(pool,{mode:'local-proof',grants,payloadKeys:keys.payload,suppressionKeys:keys.suppression,smtpPort},mode);
 return {admission,worker};
}
