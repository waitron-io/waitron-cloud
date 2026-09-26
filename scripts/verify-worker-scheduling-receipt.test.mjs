import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyWorkerSchedulingReceipt} from './verify-worker-scheduling-receipt.mjs';

function validReceipt(){
  const measurement=()=>({
    monitorScheduling:{durationMs:12.5,operations:240},
    backupScheduling:{durationMs:12.5,operations:720,repeatedIdleSweeps:1,repeatedIdleSweepDurationMs:3.5},
    monitorPolling:{durationMs:12.5,operations:240,scheduleSweeps:1},
    alertFanout:{durationMs:12.5,operations:32},
    emailDelivery:{durationMs:12.5,operations:32,backlogLagMs:14.5},
  });
  return {
    schemaVersion:1,mode:'compare',
    fixture:{venues:240,recipients:32,backupPoints:240,emailWorkers:4,scheduleLimit:100},
    machine:{platform:'darwin',architecture:'arm64',cpu:'Apple M5 Pro',logicalCpus:18,node:'v24.8.0'},
    baseline:measurement(),final:measurement(),
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

test('rejects missing cadence evidence and phase counts that do not match the fixture',()=>{
  const cadence=validReceipt();delete cadence.final.monitorPolling.scheduleSweeps;
  assert.throws(()=>verifyWorkerSchedulingReceipt(cadence),/schedule sweeps/);
  const count=validReceipt();count.final.emailDelivery.operations--;
  assert.throws(()=>verifyWorkerSchedulingReceipt(count),/emailDelivery operations/);
});

test('accepts a baseline receipt whose mirrored final section records the old loop',()=>{
  const receipt=validReceipt();receipt.mode='baseline';
  receipt.baseline.monitorPolling.scheduleSweeps=241;receipt.final.monitorPolling.scheduleSweeps=241;
  receipt.baseline.backupScheduling.repeatedIdleSweeps=240;receipt.final.backupScheduling.repeatedIdleSweeps=240;
  assert.doesNotThrow(()=>verifyWorkerSchedulingReceipt(receipt));
});
