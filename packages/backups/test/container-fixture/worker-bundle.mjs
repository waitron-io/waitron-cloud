// Synthetic data checks for worker isolation/transaction tests, never genuine archive evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {backupVerificationRequestDigest} from '/verifier/verification-protocol.ts';
import {validateArtifact} from './fixture-restore.mjs';
export const BACKUP_VERIFICATION_MODULES=[{name:'fixture-only'}];
const target=JSON.parse(await readFile(new URL('./target.json',import.meta.url),'utf8'));
export function currentBackupVerificationTarget(){return target;}
export async function verifyBackupArtifact(request,deps){
 const denied=async operation=>{try{await operation();return false;}catch(error){return error.code==='ERR_ACCESS_DENIED';}};
 assert(await denied(()=>readFile('/etc/hosts')));
 assert(await denied(()=>writeFile('/verifier/forbidden','forbidden')));
 assert.throws(()=>spawn(process.execPath,['-e','']),/permission|denied/i);
 assert.throws(()=>process.dlopen({exports:{}},'/missing-addon.node'),{code:'ERR_DLOPEN_DISABLED'});
 assert(await new Promise(resolve=>{try{const socket=createConnection({host:'127.0.0.1',port:9});socket.once('error',e=>resolve(e.code==='ERR_ACCESS_DENIED'));socket.once('connect',()=>{socket.destroy();resolve(false);});}catch(e){resolve(e.code==='ERR_ACCESS_DENIED');}}));
 assert.deepEqual(deps.recoveryKey.version,request.backupKey.version);assert.deepEqual(deps.recoveryKey.reference,request.backupKey.reference);
 const artifact=await readFile(deps.artifactPath),mode=artifact[0];
 const result={protocol:request.protocol,requestDigest:backupVerificationRequestDigest(request),attemptToken:request.attempt.childToken,
 measuredArchive:{sha256:request.archive.sha256,bytes:request.archive.bytes},targetDigest:request.target.digest,policyDigest:request.target.policyDigest,
 modules:request.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})),status:'passed',reason:'none',activation:'not_attempted'};
 if(mode===4)return {...result,status:'invalid',reason:'archive_invalid',modules:[]};
 const checked=await validateArtifact({artifact,stateDir:deps.scratchRoot});
 const sourceNodeId=checked.secretEntries[0].bytes.toString().split('=')[1];
 if(sourceNodeId!==request.sourceNodeId||JSON.stringify(request.archive.modules)!=='{"fake":1}'||request.capturedAt!=='2026-09-26T00:00:00.000Z')return {...result,status:'invalid',reason:'archive_invalid',modules:[]};
 const side=join(deps.scratchRoot,'integrity.db');await writeFile(side,checked.dumpEntry.bytes,{mode:0o600});
 try{const db=new DatabaseSync(side,{readOnly:true});try{assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(r=>r.integrity_check),['ok']);}finally{db.close();}}finally{await rm(side);}
 return result;
}
