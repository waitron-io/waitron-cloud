import assert from 'node:assert/strict';
import {test} from 'node:test';
import {statfs} from 'node:fs/promises';
import {tmpdir} from 'node:os';

test('machine sampling uses available resources and fifteen-minute load in explicit units',async()=>{
 const {readMachine}=await import('./operations-machine.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof readMachine,'function');
 assert.deepEqual(await readMachine({read:async path=>{assert.equal(path,'/proc/meminfo');return 'MemTotal: 100 kB\nMemAvailable: 25 kB\nMemFree: 1 kB\n';},
  diskStat:async path=>{assert.equal(path,'/run/local-stack');return {blocks:200,bavail:25,bfree:190};},load:()=>[1,2,7.5],cpuCount:()=>4}),
 {disk:.875,memory:.75,load:1.875});
});

test('machine sampling keeps independent readings when a resource is missing or invalid',async()=>{
 const {readMachine}=await import('./operations-machine.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof readMachine,'function');
 const inputs={read:async()=>{throw Error('private path');},diskStat:async()=>({blocks:100,bavail:50}),load:()=>[1,2,4],cpuCount:()=>2};
 assert.deepEqual(await readMachine(inputs),{disk:.5,memory:null,load:2});
 assert.deepEqual(await readMachine({...inputs,read:async()=> 'MemTotal: 0 kB\nMemAvailable: 10 kB\n',diskStat:async()=>({blocks:0,bavail:0}),cpuCount:()=>0}),{disk:null,memory:null,load:null});
});

test('real Linux sampling reads procfs and operating-system resources',{skip:process.platform!=='linux'},async()=>{
 const {readMachine}=await import('./operations-machine.mjs');
 const sample=await readMachine({diskStat:()=>statfs(tmpdir())});
 assert.ok(sample.disk>=0&&sample.disk<=1&&sample.disk!==null);
 assert.ok(sample.memory>=0&&sample.memory<=1&&sample.memory!==null);
 assert.ok(Number.isFinite(sample.load)&&sample.load>=0);
});
