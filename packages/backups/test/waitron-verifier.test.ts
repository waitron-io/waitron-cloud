import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {createWaitronVerifier} from '../src/waitron-verifier.ts';
import {receipt,type ReplayableObject} from '../src/object-transfer.ts';
function chunked(value:Buffer,onDispose:()=>void):ReplayableObject{return {receipt:receipt(value),open:()=>Readable.from([value.subarray(0,Math.max(1,Math.floor(value.length/2))),value.subarray(Math.max(1,Math.floor(value.length/2)))]),async dispose(){onDispose();}};}
test('the real verifier refuses an unavailable checkout before claiming any job',async()=>{
 await assert.rejects(createWaitronVerifier('/missing/private-checkout'),/^Error: backup.verifier_configuration$/);
});

test('the isolated verifier runs Waitron restore hooks and removes its private scratch directory',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'cloud-waitron-verifier-')),checkout=join(fixture,'waitron'),scratch=join(fixture,'scratch'),server=join(checkout,'apps/server'),source=join(fixture,'source.db');
 await mkdir(join(server,'src'),{recursive:true});await mkdir(join(server,'node_modules/tsx'),{recursive:true});await mkdir(scratch);
 await writeFile(join(server,'package.json'),JSON.stringify({type:'module',dependencies:{tsx:'0.0.0'}}));
 await writeFile(join(server,'node_modules/tsx/package.json'),JSON.stringify({name:'tsx',version:'0.0.0',type:'module',exports:'./loader.mjs'}));
 await writeFile(join(server,'node_modules/tsx/loader.mjs'),'');
 await writeFile(join(server,'src/restore.ts'),`import {mkdir,writeFile} from 'node:fs/promises';export async function validateArtifact({artifact}){if(artifact[0]===0)throw Error('malformed archive details');return {manifest:{modules:{fake:1},createdAt:'2026-09-26T00:00:00.000Z'},dumpEntry:{bytes:artifact},secretEntries:[{name:'secrets/trading.env',bytes:Buffer.from('WAITRON_TILL_NODE_ID=node-a')} ]}}export async function writeValidated(_checked,deps){await mkdir(deps.venueDir,{recursive:true});await writeFile(deps.venueDir+'/restored','yes');deps.log('info','restore.hook.done',{module:'fake'})}`);
 await writeFile(join(server,'src/modules.ts'),`export const ALL_MODULES=[{name:'fake',backup:{restore(){}}}]`);
 await writeFile(join(server,'src/env-file.ts'),`export function parseEnvFile(value){return Object.fromEntries(value.trim().split('\\n').map(line=>line.split('=')))}`);
 const db=new DatabaseSync(source);db.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES (\'restored\')');db.close();
 try{
  const verify=await createWaitronVerifier(checkout,{temporaryRoot:scratch});
  const signal=new AbortController().signal;
  let disposed=0;const input=chunked(await readFile(source),()=>disposed++);
  const result=await verify(input,{recoveryKey:'test-key',streamKey:'test-stream'},{sourceNodeId:'node-a',modules:{fake:1},capturedAt:'2026-09-26T00:00:00.000Z'} as never,signal) as {networkDenied:boolean;childProcessDenied:boolean;addonDenied:boolean;hostReadDenied:boolean;outsideWriteDenied:boolean;integrityOk:boolean;hooks:string[]};
  assert.deepEqual(result,{networkDenied:true,childProcessDenied:true,addonDenied:true,hostReadDenied:true,outsideWriteDenied:true,integrityOk:true,hooks:['fake'],cloudCredentialPresent:false,staffKeyPresent:false});assert.deepEqual(await readdir(scratch),[]);assert.equal(disposed,0);await input.dispose();assert.equal(disposed,1);
  const malformed=chunked(Buffer.from([0]),()=>disposed++);await assert.rejects(verify(malformed,{recoveryKey:'test-key',streamKey:'test-stream'},{sourceNodeId:'node-a',modules:{fake:1},capturedAt:'2026-09-26T00:00:00.000Z'} as never,signal),/^Error: backup.verifier_failed$/);await malformed.dispose();
  assert.deepEqual(await readdir(scratch),[]);
 }finally{await rm(fixture,{recursive:true,force:true});}
});

test('file-backed validated archives retain integrity, identity and restore-hook checks',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'cloud-file-verifier-')),checkout=join(fixture,'waitron'),scratch=join(fixture,'scratch'),server=join(checkout,'apps/server'),source=join(fixture,'source.db');
 await mkdir(join(server,'src'),{recursive:true});await mkdir(join(server,'node_modules/tsx'),{recursive:true});await mkdir(scratch);
 await writeFile(join(server,'package.json'),'{"type":"module"}');await writeFile(join(server,'node_modules/tsx/package.json'),'{"name":"tsx","type":"module","exports":"./loader.mjs"}');await writeFile(join(server,'node_modules/tsx/loader.mjs'),'');
 await writeFile(join(server,'src/restore.ts'),`import assert from 'node:assert/strict';import {mkdir,writeFile,copyFile} from 'node:fs/promises';import {join} from 'node:path';export async function validateArtifact({artifact,stateDir}){const databasePath=join(stateDir,'validated.db');await writeFile(databasePath,artifact,{mode:0o600});return {databasePath,manifest:{modules:{fake:1},createdAt:'2026-09-26T00:00:00.000Z'},secretEntries:[{name:'secrets/trading.env',bytes:Buffer.from('WAITRON_TILL_NODE_ID=node-a')}]};}export async function writeValidated(checked,deps){assert.equal(checked.dumpEntry,undefined);await mkdir(deps.venueDir,{recursive:true});await copyFile(checked.databasePath,join(deps.venueDir,'venue.db'));deps.log('info','restore.hook.done',{module:'fake'});}`);
 await writeFile(join(server,'src/modules.ts'),`export const ALL_MODULES=[{name:'fake',backup:{restore(){}}}]`);await writeFile(join(server,'src/env-file.ts'),`export function parseEnvFile(value){return Object.fromEntries(value.trim().split('\\n').map(line=>line.split('=')))}`);
 const db=new DatabaseSync(source);db.exec('CREATE TABLE proof(value TEXT)');db.close();
 try{
  const verify=await createWaitronVerifier(checkout,{temporaryRoot:scratch}),bytes=await readFile(source),signal=new AbortController().signal,keys={recoveryKey:'test-key',streamKey:'test-stream'},point={sourceNodeId:'node-a',modules:{fake:1},capturedAt:'2026-09-26T00:00:00.000Z'};
  const result=await verify(chunked(bytes,()=>{}),keys,point as never,signal) as {integrityOk:boolean;hooks:string[]};assert.equal(result.integrityOk,true);assert.deepEqual(result.hooks,['fake']);
  await assert.rejects(verify(chunked(Buffer.alloc(64,255),()=>{}),keys,point as never,signal),/^Error: backup.verifier_failed$/);
  await assert.rejects(verify(chunked(bytes,()=>{}),keys,{...point,sourceNodeId:'another-node'} as never,signal),/^Error: backup.verifier_failed$/);
  await assert.rejects(verify(chunked(bytes,()=>{}),keys,{...point,modules:{foreign:1}} as never,signal),/^Error: backup.verifier_failed$/);
  await assert.rejects(verify(chunked(bytes,()=>{}),keys,{...point,capturedAt:'2026-09-27T00:00:00.000Z'} as never,signal),/^Error: backup.verifier_failed$/);
  assert.deepEqual(await readdir(scratch),[]);
 }finally{await rm(fixture,{recursive:true,force:true});}
});
