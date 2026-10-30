import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as diagnostic from './instrument.mjs';

// Losing loader identity confuses an old page's unload reads with the new page.
test('CDP observations distinguish documents and retain numeric initiators without private text', () => {
  const cdp = new EventEmitter(), rows = [];
  diagnostic.installRequestTrace?.(cdp, row => rows.push(row), 'https://staff.generated.example.test');
  const event = (requestId, loaderId, path, type) => ({requestId, loaderId,
    request: {url:'https://staff.generated.example.test' + path}, type,
    wallTime: 1793325694.4, initiator: {type:'script', stack:{callFrames:[
      {functionName:'PRIVATE_FUNCTION', url:'https://PRIVATE_SOURCE', lineNumber:44,columnNumber:7}]}}});
  cdp.emit('Network.requestWillBeSent', event('PRIVATE_REQUEST1','PRIVATE_OLD','/manage/','Document'));
  cdp.emit('Network.requestWillBeSent', event('PRIVATE_REQUEST2','PRIVATE_OLD','/management-api/alerts?PRIVATE_QUERY','Fetch'));
  cdp.emit('Network.requestWillBeSent', event('PRIVATE_REQUEST3','PRIVATE_NEW','/manage/','Document'));
  assert.deepEqual(rows, [
    {event:'cdp-request',request:1,loader:1,route:'document',resource:'Document',at:1793325694400,initiator:'script',frames:[{line:44,column:7}]},
    {event:'cdp-request',request:2,loader:1,route:'alerts',resource:'Fetch',at:1793325694400,initiator:'script',frames:[{line:44,column:7}]},
    {event:'cdp-request',request:3,loader:2,route:'document',resource:'Document',at:1793325694400,initiator:'script',frames:[{line:44,column:7}]},
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE|https:|generated/);
});

// Page-level console forwarding can lose a console call during document teardown.
test('CDP application observations retain teardown callbacks through the protocol boundary', () => {
  const cdp = new EventEmitter(), rows = [];
  diagnostic.installRequestTrace?.(cdp, row => rows.push(row), 'https://staff.generated.example.test');
  cdp.emit('Runtime.consoleAPICalled', {executionContextId:14,args:[{value:'cost_application=' + JSON.stringify({
    event:'fetch-start', id:22,route:'alerts',state:-1,at:1793325694400,private:'PRIVATE_URL'})}]});
  cdp.emit('Runtime.consoleAPICalled', {executionContextId:15,args:[{value:'PRIVATE_CONSOLE'}]});
  cdp.emit('Runtime.consoleAPICalled', {executionContextId:16,args:[{value:'cost_application={"event":"PRIVATE"}'}]});
  assert.deepEqual(rows,[{event:'cdp-application',context:14,action:'fetch-start',request:22,route:'alerts',state:-1,at:1793325694400}]);
  assert.doesNotMatch(JSON.stringify(rows), /PRIVATE/);
});
