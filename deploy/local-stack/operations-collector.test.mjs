import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

// Missing opt-in wiring would leave the status command unscheduled.
test('operations collection is opt-in, loopback-only and has no writable mount or Docker socket',()=>{
 const config=profiles=>JSON.parse(execFileSync('docker',['compose',...profiles,'config','--format','json'],{encoding:'utf8'}));
 assert.equal(config([]).services['operations-collector'],undefined);
 const services=config(['--profile','operations']).services;
 const service=services['operations-collector'];
 assert.ok(service,'the opt-in collector must exist');
 assert.equal(service.read_only,true);
 assert.equal(service.restart,'unless-stopped');
 assert.equal(service.network_mode,undefined);
 assert(service.ports.every(port=>port.host_ip==='127.0.0.1'));
 assert(service.ports.some(port=>port.target===9091));
 assert(service.volumes.every(volume=>volume.read_only&&volume.target==='/run/local-stack'));
 assert.equal(service.depends_on.migrate.condition,'service_completed_successfully');
});

const snapshot=()=>({version:1,checkedAt:new Date().toISOString(),state:'ready',ready:true,components:{
 controlApi:{state:'ready',code:'ready',elapsedMs:1},monitoring:{state:'ready',code:'no_targets',venues:0,due:0,unknown:0,incidents:0},
 email:{state:'ready',code:'empty',counts:{pending:0,processing:0,sent:0,expired:0,cancelled:0,failed:0},backlogged:0},
 backups:{state:'ready',code:'empty',counts:{pending:0,running:0,failed:0,completed:0},due:0},
 remoteConfiguration:{state:'ready',code:'no_targets',enabled:0,due:0,running:0,failed:0},
 gateways:{state:'ready',code:'no_targets',expected:0,healthy:0,failed:0,stale:0,missing:0},
 storage:{state:'ready',code:'no_targets',expected:0,healthy:0,pending:0,failed:0,stale:0,missing:0},
 usage:{state:'ready',code:'current',sources:4,stale:0,unknown:0}
}});

test('failure and elapsed freshness suppress the previous healthy sample and recover',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 let time=100000,fail=false;
 const collection=createCollection({intervalMs:1000,timeoutMs:2000,now:()=>time,collect:async()=>{if(fail)throw Error('secret database URL');return snapshot();}});
 assert.equal(collection.status().collection.state,'pending');
 await collection.poll();assert.equal(collection.status().snapshot.ready,true);
 assert.match(collection.metrics(),/waitron_cloud_operations_ready 1\n/);
 time+=3001;
 assert.equal(collection.status().collection.state,'stale');assert.equal(collection.status().snapshot,null);
 assert.doesNotMatch(collection.metrics(),/waitron_cloud_operations_ready /);
 fail=true;await collection.poll();
 assert.equal(collection.status().collection.state,'failed');assert.equal(collection.status().snapshot,null);
 assert.doesNotMatch(JSON.stringify(collection.status()),/secret/);
 assert.match(collection.metrics(),/waitron_cloud_collection_success 0\n/);
 fail=false;await collection.poll();assert.equal(collection.status().collection.state,'current');
});

test('overlapping polls are single-flight and incompatible output cannot replace status',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 let release,calls=0;
 const collection=createCollection({intervalMs:1000,collect:()=>{calls++;return new Promise(resolve=>{release=resolve;});}});
 const first=collection.poll();await collection.poll();assert.equal(calls,1);
 release(snapshot());await first;assert.equal(collection.status().snapshot.ready,true);
 const second=collection.poll();release({...snapshot(),version:2});await second;
 assert.equal(collection.status().collection.state,'failed');assert.equal(collection.status().snapshot,null);
});

test('scrapes expose failure without stale health and the service closes on stop',async()=>{
 const {serveCollection}=await import('./operations-collector.mjs');
 const controller=new AbortController();
 const {server,done}=await serveCollection({collect:async()=>{throw Error('secret');},intervalMs:1000,port:0,host:'127.0.0.1',signal:controller.signal});
 try{
  const url=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(`${url}/status`);assert.equal(response.status,503);
  const status=await response.json();assert.equal(status.collection.state,'failed');assert.equal(status.snapshot,null);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const metrics=await fetch(`${url}/metrics`);assert.equal(metrics.status,200);
  const text=await metrics.text();assert.match(text,/waitron_cloud_collection_success 0\n/);assert.doesNotMatch(text,/secret|waitron_cloud_operations_ready /);
  assert.equal((await fetch(`${url}/unknown`)).status,404);
  assert.equal((await fetch(`${url}/status`,{method:'POST'})).status,404);
 }finally{controller.abort();await done;}
 assert.equal(server.listening,false);
});

test('an unfinished HTTP request cannot hold collection shutdown open',async()=>{
 const {serveCollection}=await import('./operations-collector.mjs');
 const {connect}=await import('node:net');const {once}=await import('node:events');
 const controller=new AbortController();
 const {server,done}=await serveCollection({collect:async()=>{throw Error();},port:0,host:'127.0.0.1',signal:controller.signal});
 const socket=connect(server.address().port,'127.0.0.1');
 try{
  await once(socket,'connect');socket.write('GET /status HTTP/1.1\r\nHost: localhost\r\n');
  await new Promise(resolve=>setTimeout(resolve,20));controller.abort();
  const stopped=await Promise.race([done.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),500))]);
  assert.equal(stopped,true,'stop must close an unfinished scrape connection');
 }finally{socket.destroy();controller.abort();await done;}
});
