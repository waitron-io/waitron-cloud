import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {createBoundContainerWaitronVerifier} from '../../packages/backups/src/container-verifier.ts';
import {openVerifierController} from './verifier-controller.mjs';
const execute=promisify(execFile);
export const verifierWaitronRevision='5516dd57e9ae4c52e1a68f35f1e1860ff00e2faa';
export async function openTestBackupVerifier({directory,image,owner='waitron-cloud-test-backup',memoryMiB=1024,scratchMiB=256}){
 if(!/^sha256:[a-f0-9]{64}$/.test(image??''))throw Error('test_cloud.verifier_configuration');
 let info;try{[info]=JSON.parse((await execute('docker',['image','inspect',image],{timeout:10000,maxBuffer:65536})).stdout);}catch{throw Error('test_cloud.verifier_configuration');}
 if(info.Id!==image||info.Config.Labels?.['cloud.waitron-revision']!==verifierWaitronRevision)throw Error('test_cloud.verifier_configuration');
 const controller=await openVerifierController({directory:join(directory,'verifier-controller'),owner,image});
 return {verify:await createBoundContainerWaitronVerifier({image,owner,controller,memoryMiB,scratchMiB}),controllerScope:controller.scope};
}
// A dedicated PostgreSQL session serialises trusted controllers across worker restarts.
export async function claimTestBackupWorker(pool,onLost=()=>{}){
 const client=await pool.connect();let lost=false,released=false;
 const failed=()=>{lost=true;onLost();};client.on('error',failed);
 try{const result=await client.query('SELECT pg_try_advisory_lock(hashtext(current_schema()),7905) AS owned');if(!result.rows[0].owned)throw Error('test_cloud.verifier_busy');}
 catch(error){client.removeListener('error',failed);client.release(lost);throw error;}
 return {async release(){if(released)return;released=true;try{if(!lost)await client.query('SELECT pg_advisory_unlock(hashtext(current_schema()),7905)');}finally{client.removeListener('error',failed);client.release(lost);}}};
}
