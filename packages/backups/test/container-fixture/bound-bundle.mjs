// Synthetic owner used only to exercise the Docker boundary, never a release receipt.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {createServer} from 'node:net';
import {backupVerificationRequestDigest} from '/verifier/verification-protocol.ts';
export const BACKUP_VERIFICATION_MODULES=[{name:'fixture-only'}];
export function currentBackupVerificationTarget(){return JSON.parse(readFileSyncTarget);}
const readFileSyncTarget=await readFile(new URL('./target.json',import.meta.url),'utf8');
export async function verifyBackupArtifact(request,deps){
 assert.equal(deps.migrationsRoot,'/waitron/apps/server/dist/drizzle');
 assert.equal(deps.modules,BACKUP_VERIFICATION_MODULES);
 assert.deepEqual(deps.runtime,request.target.runtime);
 assert.deepEqual(deps.recoveryKey,{version:1,reference:'key-1',secret:'private-fixture-key'});
 const bytes=await readFile(deps.artifactPath),mode=bytes[0];
 assert.deepEqual([...bytes.subarray(1)],[255,1,2]);
 assert.equal(process.getuid(),1000);
 await assert.rejects(writeFile('/verifier/forbidden','bad'));
 await assert.rejects(new Promise((resolve,reject)=>{const server=createServer(),denied=error=>reject(error);process.once('uncaughtException',denied);server.once('error',reject);server.listen(0,'127.0.0.1',()=>{process.removeListener('uncaughtException',denied);server.close(resolve);});}),{code:'ERR_ACCESS_DENIED'});
 assert.throws(()=>spawnSync('/bin/true'),/permission|denied/i);
 assert.throws(()=>new Worker('setTimeout(()=>{},1000)',{eval:true}),/permission|denied/i);
 const result={protocol:request.protocol,requestDigest:backupVerificationRequestDigest(request),attemptToken:request.attempt.childToken,measuredArchive:{sha256:request.archive.sha256,bytes:request.archive.bytes},targetDigest:request.target.digest,policyDigest:request.target.policyDigest,modules:request.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})),status:'passed',reason:'none',activation:'not_attempted'};
 if(mode===1)process.exit(0);
 if(mode===2)return {...result,modules:[]};
 if(mode===3){await writeFile('/scratch/entered','yes');await new Promise(()=>setInterval(()=>{},1000));}
 if(mode===4)return {...result,status:'invalid',reason:'archive_invalid',modules:[]};
 if(mode===5)await writeFile('/scratch/fill',Buffer.alloc(8*1024*1024));
 if(mode===6){const held=[];for(;;)held.push(Buffer.alloc(8*1024*1024,1));}
 if(mode===7){process.stdout.write(Buffer.from([0xff]));process.exit(0);}
 if(mode===8){process.stdout.write('x'.repeat(32769));process.exit(0);}
 if(mode===9){process.stdout.write(JSON.stringify({...result,attemptToken:'forged'}));process.exit(0);}
 if(mode===10){process.stdout.write('{"status":"passed","status":"passed"}');process.exit(0);}
 if(mode===15){await writeFile('/scratch/entered','yes');for(;;){}}
 if(mode===12){process.stdout.write('x'.repeat(32769));await new Promise(()=>setInterval(()=>{},1000));}
 if(mode===13){process.stderr.write('x'.repeat(65537));await new Promise(()=>setInterval(()=>{},1000));}
 if(mode===11)throw Error('private-fixture-key');
 return result;
}
