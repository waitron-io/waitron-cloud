import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { prepareDelayedLitestreamStop, createDelayedPutGate } from './litestream-smoke-test-utils.mjs';
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
// Uses the helper's actual generated forwarding and readiness behavior with real HTTP.
const source = `let stage = 'prepare'; const version='0.5.17', injectedFailures=0;
  const backend=createServer((req,res)=>{req.resume();req.on('end',()=>res.end());});
  backend.listen(0,'127.0.0.1'); await once(backend,'listening');
  const fault=createServer((req,res)=>{
    let requestBytes = 0;
    const upstream=request('http://127.0.0.1:'+backend.address().port,{method:req.method,path:req.url},incoming=>{
      res.writeHead(incoming.statusCode, incoming.headers); incoming.on('error', () => res.destroy()); incoming.pipe(res);
    }); upstream.on('error',()=>res.destroy());req.pipe(upstream);
  });
  fault.listen(0,'127.0.0.1');await once(fault,'listening');
  const endpoint='http://127.0.0.1:'+fault.address().port;
  const sale=async()=>{};
  try {
    await fetch(endpoint+'/private/ltx/0000/0000000000000001-0000000000000001.ltx',{method:'PUT',body:'initial'});
    await sale(2);
    stage = 'stop'; onStop();
    const result = { version, injectedFailures, };return result;
  } finally {
    await cleanup.promise;
    fault.closeAllConnections();backend.closeAllConnections();
    await Promise.all([new Promise(r=>fault.close(r)),new Promise(r=>backend.close(r))]);
  }`;

for (const ignored of [null, {name:'old compaction',path:'/private/ltx/0001/0000000000000001-0000000000000001.ltx'}, {name:'unknown object',path:'/private/not-an-ltx-object'}, {name:'multipart part',path:'/private/ltx/0000/0000000000000002-0000000000000002.ltx?partNumber=1&uploadId=synthetic'}]) test(`post-sale ${ignored ? ignored.name+' must not release' : 'new transaction releases'} readiness`, { timeout: 12000 }, async () => {
  const ready=deferred(), cleanup=deferred(); let endpoint, stopped=false;
  const timers=new Set();
  const set=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn();},ms);timers.add(timer);if(ms===5000)ready.resolve();return timer;};
  const generated=prepareDelayedLitestreamStop(source).replace("const sale=async()=>{};", "const sale=async()=>{ expose(endpoint); };");
  const done=new AsyncFunction('createServer','request','once','fetch','onStop','cleanup','setTimeout','clearTimeout','expose',generated)(
    createServer,request,once,fetch,()=>{stopped=true;},cleanup,set,t=>{timers.delete(t);clearTimeout(t);},e=>{endpoint=e;});
  // Attach rejection handling before awaiting a boundary to retain cleanup on failure.
  const result=done.then(value=>({value}),error=>({error}));
  let refusal;
  try {
    await ready.promise;
    if (ignored) {
      await fetch(endpoint+ignored.path,{method:'PUT',body:'older-compacted-copy'});
      try { assert.equal(stopped,false,ignored.name+' must not start stop before a complete new transaction upload is sent'); }
      catch(error){refusal=error;}
    }
    await fetch(endpoint+'/private/ltx/0000/0000000000000002-0000000000000002.ltx',{method:'PUT',body:'final'});
    assert.equal(stopped,true,'transaction 2 must release readiness');
  } finally {
    cleanup.resolve();const settled=await result;
    for(const timer of timers)clearTimeout(timer);
    if(settled.error)throw settled.error;
  }
  if(refusal)throw refusal;
});

// Removing prior-reply settlement would start stop with two committed replies held.
for (const releaseFinalFirst of [false, true]) test(`readiness requires an older post-sale reply to settle while the new reply stays held: finalFirst=${releaseFinalFirst}`, { timeout: 3000 }, async () => {
  const readiness = deferred(), cleanup = deferred();
  const held = [], waiters = []; let deadline, stopped = false, endpoint;
  const timer = (action, milliseconds) => {
    let released = false;
    const entry = { action() { if (!released) { released = true; action(); } }, milliseconds };
    if (milliseconds === 5000) { deadline = entry; readiness.resolve(); }
    else { assert.equal(milliseconds, 1500); held.push(entry); waiters.shift()?.(); }
    return entry;
  };
  const waitForHeld = async count => { while (held.length < count) await new Promise(resolve => waiters.push(resolve)); };
  const generated = prepareDelayedLitestreamStop(source).replace("const sale=async()=>{};", "const sale=async()=>{ expose(endpoint); };");
  const done = new AsyncFunction('createServer','request','once','fetch','onStop','cleanup','setTimeout','clearTimeout','expose',generated)(
    createServer,request,once,fetch,()=>{ stopped = true; },cleanup,timer,()=>{},value=>{ endpoint = value; });
  const result = done.then(value=>({value}),error=>({error}));
  const requests = [];
  try {
    await waitForHeld(1); held[0].action(); await readiness.promise;
    requests.push(fetch(endpoint+'/private/ltx/0001/0000000000000001-0000000000000001.ltx',{method:'PUT',body:'old'}));
    await waitForHeld(2);
    requests.push(fetch(endpoint+'/private/ltx/0000/0000000000000002-0000000000000002.ltx',{method:'PUT',body:'new'}));
    await waitForHeld(3); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(stopped, false, 'an older committed reply must settle before stop begins');
    if (releaseFinalFirst) { held[2].action(); await requests[1]; }
    held[1].action(); await requests[0]; await new Promise(resolve=>setImmediate(resolve));
    assert.equal(stopped, !releaseFinalFirst, 'readiness must still have an outstanding new-transaction reply');
    if (!releaseFinalFirst) { held[2].action(); await requests[1]; }
    else deadline.action();
  } finally {
    for (const entry of held) { try { entry.action(); } catch {} }
    cleanup.resolve();
    const settled = await result;
    await Promise.allSettled(requests);
    if (settled.error && !(releaseFinalFirst && /Final synthetic PUT did not commit/.test(settled.error.message))) throw settled.error;
  }
});

for (const [name, method, path, status] of [
  ['failed new upload', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx', 503],
  ['redirected new upload', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx', 301],
  ['informational response', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx', 100],
  ['read of new transaction', 'GET', '/stream/0000/0000000000000002-0000000000000002.ltx', 200],
  ['multipart completion identifier', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx?uploadId=synthetic', 200],
  ['encoded multipart identifier', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx?%75ploadId=synthetic', 200],
  ['bare multipart part parameter', 'PUT', '/stream/0000/0000000000000002-0000000000000002.ltx?partNumber', 200],
  ['reversed transaction range', 'PUT', '/stream/0000/0000000000000003-0000000000000002.ltx', 200],
  ['zero transaction', 'PUT', '/stream/0000/0000000000000000-0000000000000002.ltx', 200],
  ['unknown compaction level', 'PUT', '/stream/0008/0000000000000002-0000000000000002.ltx', 200],
]) test(`the transaction gate refuses ${name}`, () => {
  const gate = createDelayedPutGate(); let ready = 0;
  const release = () => { ready++; };
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000001-0000000000000001.ltx'},false),200,release);
  gate.beforeSale();
  gate.response(gate.admit({method,url:path},true),status,release);
  assert.equal(ready,0);
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},true),200,release);
  assert.equal(ready,1,'a valid new upload must still release readiness after the refusal');
});

test('a failed pre-sale observation cannot establish the transaction boundary', () => {
  const gate = createDelayedPutGate(); let ready = 0;
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000001-0000000000000001.ltx'},false),503,()=>{ready++;});
  gate.beforeSale();
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},true),200,()=>{ready++;});
  assert.equal(ready,0);
});

test('a new transaction admitted before the final sale cannot release readiness with a late response', () => {
  const gate = createDelayedPutGate(); let ready = 0;
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000001-0000000000000001.ltx'},false),200,()=>{ready++;});
  const early = gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},false);
  gate.beforeSale(); gate.response(early,200,()=>{ready++;});
  assert.equal(ready,0);
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},true),200,()=>{ready++;});
  assert.equal(ready,1,'late replies must not move the captured boundary');
});

test('an older acknowledgement cannot lower the highest pre-sale transaction', () => {
  const gate = createDelayedPutGate(); let ready = 0;
  for (const url of ['/stream/0000/0000000000000002-0000000000000002.ltx',
    '/stream/0001/0000000000000001-0000000000000001.ltx']) {
    gate.response(gate.admit({method:'PUT',url},false),200,()=>{ready++;});
  }
  gate.beforeSale();
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},true),200,()=>{ready++;});
  assert.equal(ready,0);
});

for (const interrupted of [true, false]) test(`an older reply releases readiness only after complete forwarding: interrupted=${interrupted}`, async () => {
  const gate = createDelayedPutGate(); let ready = 0;
  gate.response(gate.admit({method:'PUT',url:'/stream/0000/0000000000000001-0000000000000001.ltx'},false),200,()=>{ready++;});
  gate.beforeSale();
  const older = gate.admit({method:'PUT',url:'/stream/0001/0000000000000001-0000000000000001.ltx'},true);
  gate.response(older,200,()=>{ready++;});
  const final = gate.admit({method:'PUT',url:'/stream/0000/0000000000000002-0000000000000002.ltx'},true);
  gate.response(final,200,()=>{ready++;});
  const closed = deferred();
  const server = createServer((req,res) => {
    gate.forward(older,res); res.once('close',()=>closed.resolve());
    res.writeHead(200,{'content-length':'4'});
    if (interrupted) res.write('a'); else res.end('abcd');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const client = request('http://127.0.0.1:'+server.address().port, res => {
    res.on('error',()=>{});
    res.on('data',()=>{ if(interrupted) res.destroy(); }); res.resume();
  });
  client.on('error',()=>{}); client.end();
  try {
    await closed.promise; await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ready,interrupted?0:1,'closing an incomplete older reply must not stand in for forwarding its complete response');
  } finally {
    client.destroy(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});
