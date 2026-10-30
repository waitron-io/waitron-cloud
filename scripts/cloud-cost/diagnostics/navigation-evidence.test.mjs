import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {summarizeNetlog} from './netlog-summary.mjs';
import {installRequestTrace} from './instrument.mjs';

// Collapsing these routes conceals which reload request Chrome cancels.
test('netlog distinguishes shell reads and request modes without private request text', () => {
  const paths = ['/api/theme', '/management-api/disk-stop', '/management-api/alerts',
    '/management-api/session/me', '/management-api/reports/overview', '/management-api/reports/overdue-orders'];
  const summary = summarizeNetlog({constants:{logEventTypes:{URL_REQUEST_START_JOB:1}},
    events:paths.map((path, index) => ({type:1, source:{id:index + 10}, time:String(index), phase:1,
      params:{url:'https://staff.generated.example.test' + path + '?PRIVATE_QUERY',
        request_type:index === 0 ? 'main frame' : index === 1 ? 'other' : 'PRIVATE_TYPE',
        load_flags:32768 + index, initiator:'https://PRIVATE_INITIATOR',headers:'PRIVATE_COOKIE'}}))});
  assert.deepEqual(summary.requests.map(row => row.route), ['theme','disk-stop','alerts','session','overview','overdue']);
  assert.deepEqual(summary.events.map(row => row.requestType), ['main frame','other',undefined,undefined,undefined,undefined]);
  assert.deepEqual(summary.events.map(row => row.loadFlags), [32768,32769,32770,32771,32772,32773]);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|https:|headers|initiator/);
});

// Completion and cancellation must refer to the document's existing request identity.
test('protocol completion links cancellation to the initiating document and monotonic clock', () => {
  const cdp = new EventEmitter(), rows = [];
  installRequestTrace(cdp, row => rows.push(row), 'https://staff.generated.example.test');
  cdp.emit('Network.requestWillBeSent', {requestId:'PRIVATE_REQUEST',loaderId:'PRIVATE_DOCUMENT',
    request:{url:'https://staff.generated.example.test/management-api/disk-stop?PRIVATE_QUERY'},
    type:'Fetch',wallTime:1793347222.4,timestamp:175.727,initiator:{type:'script'}});
  cdp.emit('Network.loadingFailed', {requestId:'PRIVATE_REQUEST',timestamp:175.741,
    type:'Fetch',canceled:true,errorText:'net::ERR_ABORTED',private:'PRIVATE_ERROR'});
  cdp.emit('Network.loadingFinished', {requestId:'PRIVATE_REQUEST',timestamp:175.745,encodedDataLength:123});
  cdp.emit('Network.loadingFailed', {requestId:'PRIVATE_UNKNOWN',timestamp:175.746,errorText:'PRIVATE_ERROR'});
  assert.equal(rows[0].route, 'disk-stop');
  assert.equal(rows[0].tick, 175727);
  assert.deepEqual(rows.slice(1), [
    {event:'cdp-failed',request:1,loader:1,tick:175741,cancelled:true,error:'aborted'},
    {event:'cdp-finished',request:1,loader:1,tick:175745},
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|https:|encodedDataLength/);
});
