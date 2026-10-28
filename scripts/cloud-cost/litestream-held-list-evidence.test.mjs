import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Losing a gate boundary or recording it after cleanup must lose the controlled ordering below.
function run(scenario) {
  const base = new URL('./', import.meta.url).href;
  const modules = {
    '/code/meter.mjs': `import {createMeter as create} from ${JSON.stringify(base + 'meter.mjs')};
      export * from ${JSON.stringify(base + 'meter.mjs')};
      globalThis.refused=new Promise(resolve=>{globalThis.refuse=resolve;});
      export const createMeter=options=>{const meter=create(options);return {...meter,invalidate(){meter.invalidate();globalThis.refuse();}};};`,
    '/code/litestream.mjs': `export * from ${JSON.stringify(base + 'litestream.mjs')};`,
    'node:http': `const http=process.getBuiltinModule('node:http');let servers=0;
      export const request=http.request;
      export function createServer(handler){const kind=servers++,backend=kind===0;return http.createServer((req,res)=>{
        if(backend&&${JSON.stringify(scenario)}==='initial-interrupted-before-ack'
          &&new URL(req.url,'http://local').searchParams.get('prefix')==='stream/')res.end=body=>res.write(body.subarray?body.subarray(0,1):body.slice(0,1));
        if(kind===1&&new URL(req.url,'http://local').searchParams.get('prefix')==='stream/0009/')
          {globalThis.gateResponse=res;globalThis.gateClosed=new Promise(resolve=>res.once('close',resolve));}
        return handler(req,res);
      });}`,
    'node:child_process': `import {EventEmitter} from 'node:events';import {readFileSync} from 'node:fs';
      import {createServer,request} from 'node:http';
      export const spawnSync=()=>({stdout:'0.5.17'});
      export function spawn(binary,args){
        const config=JSON.parse(readFileSync(args[2])),db=config.dbs[0],child=new EventEmitter();
        child.stderr=new EventEmitter();child.exitCode=null;child.signalCode=null;
        const scenario=${JSON.stringify(scenario)};let n=0,server,closed=false;
        const requests=[],responses=[];
        const send=(path,method='GET')=>new Promise(resolve=>{
          const req=request(db.replica.endpoint+'/synthetic/'+path,{method,headers:{
            'amz-sdk-invocation-id':'11111111-2222-4333-8444-'+String(++n).padStart(12,'0'),
            'amz-sdk-request':'attempt=1; max=3','content-length':method==='PUT'?'4':'0'}},res=>{
              responses.push(res);res.resume();res.on('error',()=>{});res.on('end',resolve);
              if(scenario==='initial-interrupted-before-ack'&&n===1)res.once('data',resolve);
          });req.on('error',resolve);requests.push(req);req.end(method==='PUT'?'four':undefined);
        });
        child.kill=()=>{if(closed)return true;closed=true;
          for(const req of requests)req.destroy();
          server.close();server.closeAllConnections();globalThis.gateResponse?.destroy();Promise.resolve(globalThis.gateClosed).then(()=>{child.exitCode=1;child.emit('close',1,null);});return true;};
        server=createServer((req,res)=>{req.resume();req.on('end',async()=>{
          if(scenario==='initial-interrupted-before-ack'){responses[0].destroy();requests[0].destroy();await globalThis.refused;}
          if(scenario==='other-before-ack')await send('?list-type=2&prefix=PRIVATE_CANARY');
          res.end(JSON.stringify({status:scenario==='invalid-ack'?'PRIVATE_CANARY':'stopped',path:db.path,txid:0}));
        });});
        server.listen(config.socket.path,async()=>{
          await send('?list-type=2&prefix=stream/');
          if(scenario==='overflow')for(let i=0;i<20;i++)await send('?list-type=2&prefix=PRIVATE_CANARY'+i);
          send('?list-type=2&prefix=stream/0009/');
          await send('stream/one.ltx','PUT');
        });return child;
      }`,
  };
  const code = `import {registerHooks} from 'node:module';const modules=${JSON.stringify(modules)};
    registerHooks({resolve(s,c,next){if(Object.hasOwn(modules,s))return {url:'data:text/javascript,'+encodeURIComponent(modules[s]),shortCircuit:true};
      if(s==='/code/meter.mjs')return {url:${JSON.stringify(base + 'meter.mjs')},shortCircuit:true};return next(s,c);}});
    await import(${JSON.stringify(base + 'fixtures/litestream-list-control.mjs')});`;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding:'utf8', timeout:5000 });
}

for (const scenario of ['held-after-ack', 'other-before-ack']) {
  test(`held-list failure records request categories and stop ordering: ${scenario}`, () => {
    const result=run(scenario);
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1,result.stderr);
    assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/PRIVATE_CANARY|11111111|synthetic|\.ltx|\/tmp\//);
    const record=result.stderr.split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).find(r=>r.kind==='litestream-native-control');
    assert.equal(record.stage,'exit');assert.equal(record.writer.code,1);
    const evidence=record.listEvidence;
    assert.ok(evidence,'failure must include LIST evidence captured before cleanup');
    assert.equal(evidence.truncated,false);
    assert.deepEqual(evidence.lists.map(r=>r.category),scenario==='other-before-ack'
      ? ['initial-list','held-retention-list','other-list']:['initial-list','held-retention-list']);
    const [initial,held,other]=evidence.lists;
    assert.ok(initial.arrived<initial.forwarded && initial.forwarded<initial.responseHeaders);
    assert.ok(initial.responseHeaders<initial.responseEnd && initial.responseEnd<evidence.stopRequested);
    assert.equal(initial.producerOutcome,'success');assert.equal(initial.observerOutcome,'success');
    assert.ok(held.arrived<evidence.stopRequested);
    assert.ok(evidence.stopRequested<evidence.stopReplyReceived && evidence.stopReplyReceived<evidence.stopAcknowledged);
    assert.ok(evidence.stopAcknowledged<evidence.heldReleased && evidence.heldReleased<=held.forwarded);
    assert.ok(held.forwarded<evidence.signalSent && evidence.signalSent<evidence.writerExited);
    if(other)assert.ok(evidence.stopRequested<other.arrived && other.responseEnd<evidence.stopReplyReceived);
    assert.equal(evidence.writerExited,evidence.lastEvent,'cleanup must not append to the captured failure');
  });
}

test('invalid stop replies retain pre-validation evidence without claiming acknowledgement or release', () => {
  const result=run('invalid-ack');
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.doesNotMatch(result.stderr,/PRIVATE_CANARY|11111111|synthetic|\.ltx|\/tmp\//);
  const record=result.stderr.split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).find(r=>r.kind==='litestream-native-control');
  assert.equal(record.stage,'stop-acknowledgement');
  const e=record.listEvidence;
  assert.ok(e.stopRequested<e.stopReplyReceived);
  for(const key of ['stopAcknowledged','heldReleased','signalSent','writerExited'])assert.equal(e[key],undefined,key);
  assert.equal(e.lists[1].forwarded,undefined);
  assert.equal(e.lists[1].clientClosed,undefined,'cleanup must not rewrite the failure record');
});

test('excess LISTs truncate evidence while leaving the held request and refusal intact', () => {
  const result=run('overflow');
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.doesNotMatch(result.stderr,/PRIVATE_CANARY|11111111|synthetic|\.ltx|\/tmp\//);
  const record=result.stderr.split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).find(r=>r.kind==='litestream-native-control');
  assert.equal(record.stage,'exit');assert.equal(record.writer.code,1);
  assert.equal(record.listEvidence.truncated,true);assert.equal(record.listEvidence.lists.length,16);
  assert.ok(record.listEvidence.stopAcknowledged<record.listEvidence.heldReleased);
  assert.ok(record.listEvidence.signalSent<record.listEvidence.writerExited);
  assert.ok(JSON.stringify(record.listEvidence).length<4096);
});


test('a real pre-acknowledgement initial LIST interruption stays refused and identifies its two outcomes', () => {
  const result=run('initial-interrupted-before-ack');
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.equal(result.stdout,'');
  assert.doesNotMatch(result.stderr,/PRIVATE_CANARY|11111111|synthetic|\.ltx|\/tmp\//);
  const record=result.stderr.split('\n').filter(l=>l.startsWith('{')).map(JSON.parse).find(r=>r.kind==='litestream-native-control');
  const [initial,held]=record.listEvidence.lists;
  assert.equal(initial.category,'initial-list');assert.equal(held.category,'held-retention-list');
  assert.equal(initial.producerOutcome,'transport-error',JSON.stringify(record));
  assert.equal(initial.responseFinished,false);
  assert.ok(initial.producerSettled<record.listEvidence.stopReplyReceived);
  assert.equal(record.diagnostic.reason,'upstream-response-interrupted');
  assert.equal(record.diagnostic.ioEvent,'response-aborted');
  assert.equal(record.diagnostic.operation,'list');
  assert.deepEqual(record.diagnostic.attempt,{producerAttempt:1,retryOrdinal:0,phase:'workload'});
});
