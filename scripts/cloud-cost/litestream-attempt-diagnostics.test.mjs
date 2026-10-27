import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport } from './litestream.mjs';

// Losing the request's admission number or retry ordinal must make an interrupted retry unidentifiable.
test('an interrupted retry keeps its own producer attempt after the successful prior exchange', async t => {
  let count=0,refuse;
  const refused=new Promise(resolve=>{refuse=resolve;});
  const backend=createServer((req,res)=>{req.resume();req.on('end',()=>{
    count++;if(count===1){res.writeHead(503);res.end();}else res.destroy();
  });});
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  t.after(()=>{backend.closeAllConnections();return new Promise(resolve=>backend.close(resolve));});
  const meter=createMeter({phase:'workload',clock:()=>0});
  const transport=await createLitestreamTransport({target:`http://127.0.0.1:${backend.address().port}`,phase:'workload',
    meter:{...meter,invalidate:()=>{meter.invalidate();refuse();}}});
  t.after(()=>transport.close().catch(()=>{}));
  const send=ordinal=>new Promise(resolve=>{
    const client=request(transport.url+'/PRIVATE_CANARY/key',{method:'PUT',headers:{
      'amz-sdk-invocation-id':'11111111-2222-4333-8444-555555555555','amz-sdk-request':`attempt=${ordinal}; max=3`,
      'content-length':'4'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));res.on('error',resolve);});
    client.on('error',resolve);client.end('four');
  });
  assert.equal(await send(1),503);await transport.whenIdle(()=>{});
  await send(2);await refused;
  const diagnostic=transport.checkpoint();
  assert.equal(diagnostic.reason,'upstream-error');assert.equal(diagnostic.operation,'put');
  assert.deepEqual(diagnostic.attempt,{producerAttempt:2,retryOrdinal:1,phase:'workload'});
  assert.equal(diagnostic.completed,2);
  assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_CANARY|11111111|amz-sdk/);
  await assert.rejects(transport.close(),error=>{
    assert.deepEqual(error.litestreamCloseDiagnostic.attempt,{producerAttempt:2,retryOrdinal:1,phase:'workload'});return true;
  });
  assert.throws(()=>meter.snapshot(),/Invalid cloud cost meter/);
});
