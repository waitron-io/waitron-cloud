import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {test} from 'node:test';
import {runRemoteProbes} from '../src/probe-runner.ts';
import type {RemoteProbeResult} from '../src/probe.ts';
import type {RemoteProbeTarget} from '../src/probe-targets.ts';

const targets=Array.from({length:6},(_,n):RemoteProbeTarget=>({installationId:`10000000-0000-4000-8000-00000000000${n}`,venueId:`20000000-0000-4000-8000-00000000000${n}`,revision:n+10,staffHostname:`staff-${n}.example.test`,publicHostname:`public-${n}.example.test`}));
const result=(target:RemoteProbeTarget):RemoteProbeResult=>({version:1,...target,checkedAt:'2026-09-25T12:00:00.000Z',public:{status:'failed',checkedAt:'2026-09-25T12:00:00.000Z',elapsedMs:1,failure:'http'},staff:{status:'failed',checkedAt:'2026-09-25T12:00:00.000Z',elapsedMs:1,failure:'tls'}});
function deferred(){let resolve!:(value?:unknown)=>void;const promise=new Promise<unknown>(done=>{resolve=done;});return {promise,resolve};}
async function until(check:()=>boolean){for(let n=0;n<100;n++){if(check())return;await immediate();}assert.fail('condition not reached');}

test('runner bounds concurrency, emits completion order and continues after one probe rejects',async()=>{
 const gates=targets.map(()=>deferred()),started:number[]=[],finished:number[]=[],emitted:RemoteProbeResult[]=[],errors:string[]=[];let active=0,maximum=0;
 const running=runRemoteProbes(targets,async target=>{const n=targets.indexOf(target);started.push(n);active++;maximum=Math.max(maximum,active);await gates[n]!.promise;active--;if(n===2)throw Error('private target failure');finished.push(n);return result(target);},{result:value=>emitted.push(value),error:()=>errors.push('failed')});
 await until(()=>started.length===4);assert.equal(maximum,4);
 gates[3]!.resolve();await until(()=>emitted.length===1&&started.length===5);gates[1]!.resolve();await until(()=>emitted.length===2&&started.length===6);gates[2]!.resolve();await until(()=>errors.length===1);
 gates[4]!.resolve();await until(()=>emitted.length===3);gates[0]!.resolve();await until(()=>emitted.length===4);gates[5]!.resolve();await running;
 assert.deepEqual(emitted.map(value=>targets.findIndex(target=>target.installationId===value.installationId)),finished);
 assert.deepEqual(emitted.map(value=>[value.venueId,value.revision]),finished.map(n=>[targets[n]!.venueId,targets[n]!.revision]));
 assert.equal(maximum,4);assert.deepEqual(errors,['failed']);
});

test('runner emits no fresh success for probes which finish after shutdown',async()=>{
 const gates=targets.slice(0,2).map(()=>deferred()),started:number[]=[],emitted:RemoteProbeResult[]=[],stop=new AbortController();
 const running=runRemoteProbes(targets.slice(0,2),async target=>{const n=targets.indexOf(target);started.push(n);await gates[n]!.promise;return result(target);},{signal:stop.signal,result:value=>emitted.push(value)});
 await until(()=>started.length===2);stop.abort();gates[0]!.resolve();gates[1]!.resolve();await running;assert.deepEqual(emitted,[]);
});

test('runner does not finish before asynchronous result persistence',async()=>{
 const gate=deferred();let settled=false;
 const running=runRemoteProbes(targets.slice(0,1),async target=>result(target),{result:async()=>{await gate.promise;}}).then(()=>{settled=true;});
 await immediate();assert.equal(settled,false);gate.resolve();await running;assert.equal(settled,true);
});

test('runner surfaces asynchronous result persistence failure',async()=>{
 await assert.rejects(runRemoteProbes(targets.slice(0,1),async target=>result(target),{result:async()=>{throw Error('storage unavailable');}}),/storage unavailable/);
});
