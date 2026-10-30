import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNetlog} from './netlog-summary.mjs';

test('netlog retains the request to socket links while excluding URLs, headers and payloads', () => {
  const result = summarizeNetlog({constants:{logEventTypes:{URL_REQUEST_START_JOB:1,
    HTTP_STREAM_REQUEST_BOUND_TO_JOB:2, SOCKET_POOL_BOUND_TO_SOCKET:3,TCP_CONNECT:4,SOCKET_BYTES_RECEIVED:5}}, events:[
    {type:1,source:{id:10},time:'123',phase:1,params:{url:'https://staff.generated.example.test/management-api/events?PRIVATE_QUERY',headers:['PRIVATE_COOKIE']}},
    {type:2,source:{id:10},time:'124',phase:0,params:{source_dependency:{id:20,type:999}}},
    {type:3,source:{id:20},time:'125',phase:0,params:{source_dependency:{id:30,type:999}}},
    {type:4,source:{id:30},time:'126',phase:2,params:{local_address:'127.0.0.1:32100',remote_address:'PRIVATE_ADDRESS'}},
    {type:1,source:{id:10},time:'127',phase:2,params:{net_error:-3,private:'PRIVATE_ERROR'}},
    {type:5,source:{id:30},time:'128',phase:0,params:{byte_count:18,bytes:'PRIVATE_PAYLOAD'}},
    {type:1,source:{id:40},time:'129',phase:1,params:{url:'https://PRIVATE_HOST/outside'}},
  ]});
  assert.deepEqual(result.requests,[{source:10,route:'live'},{source:40,route:'outside'}]);
  assert.deepEqual(result.sockets,[{source:30,port:32100}]);
  assert.ok(result.events.some(e => e.source===10 && e.dependency===20));
  assert.ok(result.events.some(e => e.source===20 && e.dependency===30));
  assert.ok(result.events.some(e => e.source===10 && e.error===-3));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|https:|127\.0\.0\.1|headers|bytes/);
});
