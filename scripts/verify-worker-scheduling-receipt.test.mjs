import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyWorkerSchedulingReceipt} from './verify-worker-scheduling-receipt.mjs';

function validReceipt(){
  const phase=()=>({durationMs:12.5,operations:4});
  return {
    schemaVersion:1,
    fixture:{venues:240,recipients:32,backupPoints:240,emailWorkers:4,scheduleLimit:100},
    machine:{platform:'darwin',architecture:'arm64',cpu:'Apple M5 Pro',logicalCpus:18,node:'v24.8.0'},
    baseline:{monitorScheduling:phase(),backupScheduling:phase(),monitorPolling:phase(),alertFanout:phase(),emailDelivery:phase()},
    final:{monitorScheduling:phase(),backupScheduling:phase(),monitorPolling:phase(),alertFanout:phase(),emailDelivery:phase()},
    correctness:{maximumScheduleInsert:100,unlockedVenueCompleted:true,restartRemaining:0,delivered:32,queued:32},
    memory:{startRssBytes:100_000_000,peakRssBytes:110_000_000},
    shutdown:{signalToStopMs:15.2,inFlightCompleted:true,postSignalClaims:0},
  };
}

test('accepts a complete bounded scheduling receipt',()=>{
  assert.doesNotThrow(()=>verifyWorkerSchedulingReceipt(validReceipt()));
});

test('rejects missing measurement phases',()=>{
  const receipt=validReceipt();
  delete receipt.final.emailDelivery;
  assert.throws(()=>verifyWorkerSchedulingReceipt(receipt),/final\.emailDelivery/);
});

test('rejects a scheduling batch above the documented bound',()=>{
  const receipt=validReceipt();
  receipt.correctness.maximumScheduleInsert=101;
  assert.throws(()=>verifyWorkerSchedulingReceipt(receipt),/schedule batch/);
});

test('rejects lost restart work and locked-row starvation',()=>{
  const lost=validReceipt();lost.correctness.restartRemaining=1;
  assert.throws(()=>verifyWorkerSchedulingReceipt(lost),/restart/);
  const starved=validReceipt();starved.correctness.unlockedVenueCompleted=false;
  assert.throws(()=>verifyWorkerSchedulingReceipt(starved),/locked venue/);
});

test('rejects work claimed after shutdown',()=>{
  const receipt=validReceipt();receipt.shutdown.postSignalClaims=1;
  assert.throws(()=>verifyWorkerSchedulingReceipt(receipt),/shutdown/);
});

test('rejects non-finite timings and memory readings',()=>{
  const timing=validReceipt();timing.baseline.monitorPolling.durationMs=Number.NaN;
  assert.throws(()=>verifyWorkerSchedulingReceipt(timing),/duration/);
  const memory=validReceipt();memory.memory.peakRssBytes=Number.POSITIVE_INFINITY;
  assert.throws(()=>verifyWorkerSchedulingReceipt(memory),/memory/);
});
