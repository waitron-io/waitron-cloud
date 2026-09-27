import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyDatabaseRecoveryReceipt} from './verify-database-recovery-receipt.mjs';

function valid(){
 return {
  schemaVersion:1,
  cloud:{head:'a'.repeat(40),dirty:false},
  measuredAt:'2026-09-27T02:00:00.000Z',
  environment:{postgresImage:'postgres:18-alpine',primaryProcess:true,standbyProcess:true,accountServerProcess:true,emailWorkerProcess:true,mailpit:true},
  roles:{
   migration:{name:'cloud_migrate',superuser:false,createDatabase:false,createRole:false,replication:false,canMigrate:true},
   runtime:{name:'cloud_app',superuser:false,createDatabase:false,createRole:false,replication:false,canReadApplication:true,canCreateSchema:false,canPromote:false},
   replication:{name:'cloud_backup',superuser:false,createDatabase:false,createRole:false,replication:true,canReadApplication:false},
  },
  recovery:{baseBackupAt:'2026-09-27T01:59:50.000Z',primaryStoppedAt:'2026-09-27T01:59:58.000Z',promotedAt:'2026-09-27T01:59:59.000Z',recoveredAt:'2026-09-27T02:00:00.000Z',primaryLsn:'0/30008A0',replayLsn:'0/30008A0',confirmedLagBytes:0,databaseUnavailableDuringOutage:true,postBackupWriteRecovered:true,promotionMs:1000,outageMs:2000},
  operation:{discardedBackendStatus:200,callerReceivedBytes:0,durableResultDigest:'b'.repeat(64),retryResultDigest:'b'.repeat(64),singleDurableResult:true,leaseUsable:true,changedActionRejected:true},
  worker:{statusAtInterruption:'processing',leaseLiveAtInterruption:true,claimRecovered:true,deliveredOnce:true},
  isolation:{firstOwnConfiguration:true,secondOwnConfiguration:true,crossTenantRejected:true},
  cleanup:{containers:0,volumes:0,networks:0},
 };
}

test('accepts a complete physical database recovery receipt',()=>assert.deepEqual(verifyDatabaseRecoveryReceipt(valid()),valid()));

for(const [name,mutate] of [
 ['dirty candidate',r=>{r.cloud.dirty=true;}],
 ['elevated runtime role',r=>{r.roles.runtime.superuser=true;}],
 ['runtime schema creation',r=>{r.roles.runtime.canCreateSchema=true;}],
 ['lagging standby replay',r=>{r.recovery.replayLsn='0/1000000';}],
 ['confirmed replay lag',r=>{r.recovery.confirmedLagBytes=1;}],
 ['changed retry result',r=>{r.operation.retryResultDigest='c'.repeat(64);} ],
 ['unsuccessful discarded backend response',r=>{r.operation.discardedBackendStatus=503;}],
 ['caller received response bytes',r=>{r.operation.callerReceivedBytes=1;}],
 ['accepted cross-tenant proof',r=>{r.isolation.crossTenantRejected=false;}],
 ['unclaimed worker at interruption',r=>{r.worker.statusAtInterruption='pending';}],
 ['expired worker lease at interruption',r=>{r.worker.leaseLiveAtInterruption=false;}],
 ['unreclaimed worker claim',r=>{r.worker.claimRecovered=false;}],
 ['duplicate recovered delivery',r=>{r.worker.deliveredOnce=false;}],
 ['leftover container',r=>{r.cleanup.containers=1;}],
 ['leftover volume',r=>{r.cleanup.volumes=1;}],
 ['leftover network',r=>{r.cleanup.networks=1;}],
 ['zero promotion time',r=>{r.recovery.promotionMs=0;}],
 ['no outage interval',r=>{r.recovery.recoveredAt=r.recovery.primaryStoppedAt;r.recovery.outageMs=0;}],
])test(`rejects ${name}`,()=>{const receipt=valid();mutate(receipt);assert.throws(()=>verifyDatabaseRecoveryReceipt(receipt),/database recovery receipt is invalid/);});
