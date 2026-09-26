import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const phaseNames=['monitorScheduling','backupScheduling','monitorPolling','alertFanout','emailDelivery'];

function finiteNumber(value,label,{integer=false,minimum=0}={}){
  assert.equal(typeof value,'number',`${label} must be a number`);
  assert(Number.isFinite(value),`${label} must be finite`);
  if(integer)assert(Number.isInteger(value),`${label} must be an integer`);
  assert(value>=minimum,`${label} must be at least ${minimum}`);
}

export function verifyWorkerSchedulingReceipt(receipt){
  assert(receipt&&typeof receipt==='object','receipt must be an object');
  assert.equal(receipt.schemaVersion,1,'schemaVersion must be 1');
  for(const [name,minimum] of [['venues',1],['recipients',1],['backupPoints',1],['emailWorkers',1],['scheduleLimit',1]]){
    finiteNumber(receipt.fixture?.[name],`fixture.${name}`,{integer:true,minimum});
  }
  assert.equal(receipt.fixture.scheduleLimit,100,'fixture.scheduleLimit must preserve the 100-row bound');
  for(const field of ['platform','architecture','cpu','node'])assert.equal(typeof receipt.machine?.[field],'string',`machine.${field} must be present`);
  finiteNumber(receipt.machine?.logicalCpus,'machine.logicalCpus',{integer:true,minimum:1});
  for(const group of ['baseline','final'])for(const phase of phaseNames){
    const value=receipt[group]?.[phase];
    assert(value&&typeof value==='object',`${group}.${phase} must be present`);
    finiteNumber(value.durationMs,`${group}.${phase}.durationMs`);
    finiteNumber(value.operations,`${group}.${phase}.operations`,{integer:true});
  }
  finiteNumber(receipt.correctness?.maximumScheduleInsert,'correctness.maximumScheduleInsert',{integer:true});
  assert(receipt.correctness.maximumScheduleInsert<=receipt.fixture.scheduleLimit,'schedule batch exceeded the documented bound');
  assert.equal(receipt.correctness.unlockedVenueCompleted,true,'a locked venue starved other due work');
  assert.equal(receipt.correctness.restartRemaining,0,'restart left durable work incomplete');
  finiteNumber(receipt.correctness.queued,'correctness.queued',{integer:true,minimum:1});
  finiteNumber(receipt.correctness.delivered,'correctness.delivered',{integer:true,minimum:1});
  assert.equal(receipt.correctness.delivered,receipt.correctness.queued,'restart lost or duplicated queued delivery work');
  finiteNumber(receipt.memory?.startRssBytes,'memory.startRssBytes',{integer:true,minimum:1});
  finiteNumber(receipt.memory?.peakRssBytes,'memory.peakRssBytes',{integer:true,minimum:1});
  assert(receipt.memory.peakRssBytes>=receipt.memory.startRssBytes,'peak memory must not precede the baseline reading');
  finiteNumber(receipt.shutdown?.signalToStopMs,'shutdown.signalToStopMs');
  assert.equal(receipt.shutdown.inFlightCompleted,true,'shutdown abandoned in-flight work');
  assert.equal(receipt.shutdown.postSignalClaims,0,'shutdown allowed a post-signal claim');
  return receipt;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const file=process.argv[2];
  if(!file)throw new Error('Usage: node scripts/verify-worker-scheduling-receipt.mjs <receipt.json>');
  verifyWorkerSchedulingReceipt(JSON.parse(await readFile(file,'utf8')));
  console.log(`Verified worker scheduling receipt: ${file}`);
}
