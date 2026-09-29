import assert from 'node:assert/strict';
import test from 'node:test';
import {migrationNames} from '../packages/registration/src/migrate.ts';
import {verifyLocalStackReceipt} from './verify-local-stack-receipt.mjs';

const identity={gatewaySigningKey:'a'.repeat(64),storageCertificate:'b'.repeat(64)};
function phase(name){return {name,durationMs:1200,imageId:'sha256:'+'c'.repeat(64),migrationCount:migrationNames.length,healthyServices:['account','email-worker','gateway','gateway-manifest','mailpit','monitor-worker','postgres','remote-probe','storage','usage-reconciler'],identity:{...identity},databaseMarker:true,storageObject:true};}
 function receipt(){return {schemaVersion:1,cloud:{head:'d'.repeat(40),dirty:false},project:'waitron-cloud-proof-12345678',startedAt:'2026-09-27T00:00:00.000Z',completedAt:'2026-09-27T00:03:00.000Z',bindings:[{service:'account',target:3000,hostIp:'127.0.0.1'},{service:'gateway',target:443,hostIp:'127.0.0.1'},{service:'gateway',target:51820,hostIp:'127.0.0.1'},{service:'mailpit',target:1025,hostIp:'127.0.0.1'},{service:'mailpit',target:8025,hostIp:'127.0.0.1'},{service:'postgres',target:5432,hostIp:'127.0.0.1'},{service:'storage',target:8333,hostIp:'127.0.0.1'}],phases:{install:phase('install'),restart:phase('restart'),upgrade:{...phase('upgrade'),rebuilt:true,recreated:true}},rollback:{sameSchemaOnly:true,databaseRecoveryExcluded:true,incompatibleSchemaRollbackExcluded:true},cleanup:{containers:0,networks:0,volumes:0,images:0}};}

test('accepts a complete clean-install, restart and upgrade receipt',()=>assert.equal(verifyLocalStackReceipt(receipt()),true));
for(const [name,mutate] of [
 ['missing health',value=>value.phases.restart.healthyServices.splice(0,1)],
 ['public binding',value=>value.bindings[0].hostIp='0.0.0.0'],
 ['changed identity',value=>value.phases.upgrade.identity.gatewaySigningKey='e'.repeat(64)],
 ['missing database marker',value=>value.phases.restart.databaseMarker=false],
 ['missing storage object',value=>value.phases.upgrade.storageObject=false],
 ['absent upgrade',value=>delete value.phases.upgrade],
 ['dirty source',value=>value.cloud.dirty=true],
 ['incomplete cleanup',value=>value.cleanup.volumes=1],
 ['leftover proof image',value=>value.cleanup.images=1],
])test(`rejects ${name}`,()=>{const value=receipt();mutate(value);assert.throws(()=>verifyLocalStackReceipt(value),/local_stack_receipt_invalid/);});

test('rejects secret-bearing or unversioned extra fields',()=>{const value=receipt();value.token='private';assert.throws(()=>verifyLocalStackReceipt(value),/local_stack_receipt_invalid/);});
