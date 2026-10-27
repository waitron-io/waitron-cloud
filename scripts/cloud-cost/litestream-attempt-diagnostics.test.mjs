import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Server, createServer, request } from 'node:http';
import { once } from 'node:events';
import { createMeter } from './meter.mjs';
import { createLitestreamTransport, withLitestreamCloseDiagnostics } from './litestream.mjs';

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
  const records=[];
  await assert.rejects(withLitestreamCloseDiagnostics({stage:'replication-transport',close:()=>transport.close(),report:line=>records.push(JSON.parse(line))}));
  assert.deepEqual(records.at(-1).attempt,{producerAttempt:2,retryOrdinal:1,phase:'workload'});
  assert.doesNotMatch(JSON.stringify(records),/PRIVATE_CANARY|11111111|amz-sdk/);
  assert.throws(()=>meter.snapshot(),/Invalid cloud cost meter/);
});

// The published attempt fields must obey the same closed privacy boundary as the other diagnostics.
test('published close attempts refuse unsafe values and do not read accessors',async()=>{
  let reads=0;
  for(const attempt of [{producerAttempt:1,retryOrdinal:0,phase:'PRIVATE_CANARY'},
    {producerAttempt:-1,retryOrdinal:0,phase:'workload'},
    {producerAttempt:0,retryOrdinal:0,phase:'workload'},
    {producerAttempt:1.5,retryOrdinal:0,phase:'workload'},
    {producerAttempt:Number.MAX_SAFE_INTEGER+1,retryOrdinal:0,phase:'workload'},
    {producerAttempt:1,retryOrdinal:-1,phase:'workload'},
    {producerAttempt:1,retryOrdinal:Number.MAX_SAFE_INTEGER+1,phase:'workload'},
    {producerAttempt:1,retryOrdinal:0.5,phase:'workload'},
    {get producerAttempt(){reads++;throw Error('PRIVATE_CANARY');},retryOrdinal:0,phase:'workload'}]){
    const error=Object.assign(Error('PRIVATE_CANARY'),{litestreamCloseDiagnostic:{reason:'upstream-error',attempt}}),records=[];
    await assert.rejects(withLitestreamCloseDiagnostics({stage:'replication-transport',close:()=>{throw error;},report:line=>records.push(JSON.parse(line))}),e=>e===error);
    assert.equal(records.at(-1).attempt,undefined);assert.doesNotMatch(JSON.stringify(records),/PRIVATE_CANARY/);
  }
  assert.equal(reads,0);
});

// Removing attribution from the socket snapshot must lose the printed attempt even with the transfer path intact.
test('a socket write error publishes the active request attempt while refusing accounting',async t=>{
  let received,destination;
  const active=new Promise(resolve=>{received=resolve;});
  const backend=createServer((req,res)=>{req.on('error',()=>{});req.resume();req.on('end',()=>{
    res.writeHead(200,{'content-length':100});res.write('partial');
  });});
  backend.listen(0,'127.0.0.1');await once(backend,'listening');
  t.after(()=>{backend.closeAllConnections();return new Promise(resolve=>backend.close(resolve));});
  const meter=createMeter({phase:'workload',clock:()=>0});
  const transport=await createLitestreamTransport({target:`http://127.0.0.1:${backend.address().port}`,meter,phase:'workload'});
  t.after(()=>transport.close().catch(()=>{}));
  const emit=Server.prototype.emit;
  t.mock.method(Server.prototype,'emit',function(event,...args){
    if(event==='request'&&args[0].socket.localPort===Number(new URL(transport.url).port))destination=args[1];
    return emit.call(this,event,...args);
  });
  const client=request(transport.url+'/PRIVATE_CANARY?list-type=2',{headers:{
    'amz-sdk-invocation-id':'11111111-2222-4333-8444-555555555555','amz-sdk-request':'attempt=1; max=3'}},res=>{
    res.on('error',()=>{});res.once('data',received);res.resume();
  });
  client.on('error',()=>{});t.after(()=>client.destroy());client.end();await active;
  destination.socket.emit('error',Object.assign(Error('PRIVATE_CANARY'),{code:'EPIPE'}));
  const records=[];
  await assert.rejects(withLitestreamCloseDiagnostics({stage:'replication-transport',close:()=>transport.close(),report:line=>records.push(JSON.parse(line))}));
  assert.deepEqual(records.at(-1).attempt,{producerAttempt:1,retryOrdinal:0,phase:'workload'});
  assert.equal(records.at(-1).diagnostic.reason,'client-error');assert.equal(records.at(-1).diagnostic.code,'EPIPE');
  assert.throws(()=>meter.snapshot(),/Invalid cloud cost meter/);assert.doesNotMatch(JSON.stringify(records),/PRIVATE_CANARY|11111111/);
});
