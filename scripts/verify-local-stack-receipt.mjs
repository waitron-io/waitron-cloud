import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {migrationNames} from '../packages/registration/src/migrate.ts';

const healthy=['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'];
const bindingKeys=['account:3000','gateway:443','gateway:51820','mailpit:1025','mailpit:8025','postgres:5432','storage:8333'];
function keys(value,expected){assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...expected].sort());}
function iso(value){assert.equal(typeof value,'string');assert.equal(new Date(value).toISOString(),value);return Date.parse(value);}
function identity(value){keys(value,['gatewaySigningKey','storageCertificate']);assert.match(value.gatewaySigningKey,/^[0-9a-f]{64}$/);assert.match(value.storageCertificate,/^[0-9a-f]{64}$/);}
function phase(value,name,upgrade=false){
 keys(value,['name','durationMs','imageId','migrationCount','healthyServices','identity','databaseMarker','storageObject',...(upgrade?['rebuilt','recreated']:[])]);
 assert.equal(value.name,name);assert(Number.isSafeInteger(value.durationMs)&&value.durationMs>=0&&value.durationMs<=3600000);assert.match(value.imageId,/^sha256:[0-9a-f]{64}$/);
 assert.equal(value.migrationCount,migrationNames.length);assert.deepEqual(value.healthyServices,healthy);identity(value.identity);assert.equal(value.databaseMarker,true);assert.equal(value.storageObject,true);
 if(upgrade){assert.equal(value.rebuilt,true);assert.equal(value.recreated,true);}
}
export function verifyLocalStackReceipt(value){
 try{
  keys(value,['schemaVersion','cloud','project','startedAt','completedAt','bindings','phases','rollback','cleanup']);assert.equal(value.schemaVersion,1);
  keys(value.cloud,['head','dirty']);assert.match(value.cloud.head,/^[0-9a-f]{40}$/);assert.equal(value.cloud.dirty,false);assert.match(value.project,/^waitron-cloud-proof-[a-z0-9-]{8,64}$/);
  assert(iso(value.completedAt)>=iso(value.startedAt));assert(Array.isArray(value.bindings));
  const bindings=value.bindings.map(binding=>{keys(binding,['service','target','hostIp']);assert.equal(binding.hostIp,'127.0.0.1');assert(Number.isSafeInteger(binding.target));return `${binding.service}:${binding.target}`;}).sort();assert.deepEqual(bindings,bindingKeys);
  keys(value.phases,['install','restart','upgrade']);phase(value.phases.install,'install');phase(value.phases.restart,'restart');phase(value.phases.upgrade,'upgrade',true);
  assert.deepEqual(value.phases.restart.identity,value.phases.install.identity);assert.deepEqual(value.phases.upgrade.identity,value.phases.install.identity);
  keys(value.rollback,['sameSchemaOnly','databaseRecoveryExcluded','incompatibleSchemaRollbackExcluded']);for(const item of Object.values(value.rollback))assert.equal(item,true);
  keys(value.cleanup,['containers','networks','volumes','images']);assert.deepEqual(value.cleanup,{containers:0,networks:0,volumes:0,images:0});return true;
 }catch{throw new Error('local_stack_receipt_invalid');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const path=process.argv[2];if(!path||process.argv.length!==3)throw Error();verifyLocalStackReceipt(JSON.parse(await readFile(path,'utf8')));console.log('PASS: local stack clean install, restart, upgrade and cleanup receipt verified');}
 catch{console.error('Local stack receipt is invalid');process.exitCode=1;}
}
