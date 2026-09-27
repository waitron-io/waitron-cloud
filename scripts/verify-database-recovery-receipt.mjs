import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

function exact(value,keys){
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
}
function iso(value){assert.equal(new Date(value).toISOString(),value);return Date.parse(value);}
function nonNegative(value){assert(Number.isFinite(value)&&value>=0);}
function role(value,name,extra){
 exact(value,['name','superuser','createDatabase','createRole',...Object.keys(extra)]);
 assert.equal(value.name,name);assert.equal(value.superuser,false);assert.equal(value.createDatabase,false);assert.equal(value.createRole,false);
 for(const [field,want] of Object.entries(extra))assert.equal(value[field],want);
}
function invalid(){throw new Error('database recovery receipt is invalid');}

export function verifyDatabaseRecoveryReceipt(receipt){
 try{
  exact(receipt,['schemaVersion','cloud','measuredAt','environment','roles','recovery','operation','worker','isolation','cleanup']);
  assert.equal(receipt.schemaVersion,1);
  exact(receipt.cloud,['head','dirty']);assert.match(receipt.cloud.head,/^[0-9a-f]{40}$/);assert.equal(receipt.cloud.dirty,false);iso(receipt.measuredAt);
  exact(receipt.environment,['postgresImage','primaryProcess','standbyProcess','accountServerProcess','emailWorkerProcess','mailpit']);
  assert.equal(receipt.environment.postgresImage,'postgres:18-alpine');
  for(const field of ['primaryProcess','standbyProcess','accountServerProcess','emailWorkerProcess','mailpit'])assert.equal(receipt.environment[field],true);
  exact(receipt.roles,['migration','runtime','replication']);
  role(receipt.roles.migration,'cloud_migrate',{replication:false,canMigrate:true});
  role(receipt.roles.runtime,'cloud_app',{replication:false,canReadApplication:true,canCreateSchema:false,canPromote:false});
  role(receipt.roles.replication,'cloud_backup',{replication:true,canReadApplication:false});
  assert.equal(new Set(Object.values(receipt.roles).map(value=>value.name)).size,3);
  exact(receipt.recovery,['baseBackupAt','primaryStoppedAt','promotedAt','recoveredAt','primaryLsn','replayLsn','confirmedLagBytes','databaseUnavailableDuringOutage','postBackupWriteRecovered','promotionMs','outageMs']);
  const backup=iso(receipt.recovery.baseBackupAt),stopped=iso(receipt.recovery.primaryStoppedAt),promoted=iso(receipt.recovery.promotedAt),recovered=iso(receipt.recovery.recoveredAt);
  assert(backup<=stopped&&stopped<=promoted&&promoted<=recovered);
  assert.match(receipt.recovery.primaryLsn,/^[0-9A-F]+\/[0-9A-F]+$/i);assert.match(receipt.recovery.replayLsn,/^[0-9A-F]+\/[0-9A-F]+$/i);
  assert.equal(receipt.recovery.confirmedLagBytes,0);assert.equal(receipt.recovery.databaseUnavailableDuringOutage,true);assert.equal(receipt.recovery.postBackupWriteRecovered,true);
  nonNegative(receipt.recovery.promotionMs);nonNegative(receipt.recovery.outageMs);
  exact(receipt.operation,['responseDropped','durableResultDigest','retryResultDigest','singleDurableResult','leaseUsable','changedActionRejected']);
  assert.match(receipt.operation.durableResultDigest,/^[0-9a-f]{64}$/);assert.equal(receipt.operation.retryResultDigest,receipt.operation.durableResultDigest);
  for(const field of ['responseDropped','singleDurableResult','leaseUsable','changedActionRejected'])assert.equal(receipt.operation[field],true);
  exact(receipt.worker,['claimInterrupted','claimRecovered','deliveredOnce']);for(const value of Object.values(receipt.worker))assert.equal(value,true);
  exact(receipt.isolation,['firstOwnConfiguration','secondOwnConfiguration','crossTenantRejected']);for(const value of Object.values(receipt.isolation))assert.equal(value,true);
  exact(receipt.cleanup,['containers','volumes','networks']);for(const value of Object.values(receipt.cleanup))assert.equal(value,0);
  return receipt;
 }catch{return invalid();}
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 if(process.argv.length!==3)throw new Error('usage: verify-database-recovery-receipt.mjs RECEIPT.json');
 const receipt=verifyDatabaseRecoveryReceipt(JSON.parse(await readFile(process.argv[2],'utf8')));
 console.log(`verified database recovery receipt from ${receipt.measuredAt}`);
}
