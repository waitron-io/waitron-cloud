import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {RequestMetrics} from '../../packages/account-http/src/request-metrics.ts';

// Missing opt-in wiring would leave the status command unscheduled.
test('operations collection is opt-in, loopback-only and has no writable mount or Docker socket',()=>{
 const config=profiles=>JSON.parse(execFileSync('docker',['compose',...profiles,'config','--format','json'],{encoding:'utf8',env:{...process.env,CLOUD_ACCOUNT_FAILURE_RULES:'explicit-test-setting',CLOUD_MACHINE_TREND_RULES:'explicit-machine-setting'}}));
 assert.equal(config([]).services['operations-collector'],undefined);
 const services=config(['--profile','operations']).services;
 const service=services['operations-collector'];
 assert.ok(service,'the opt-in collector must exist');
 assert.equal(service.environment.CLOUD_ACCOUNT_FAILURE_RULES,'explicit-test-setting');
 assert.equal(service.environment.CLOUD_MACHINE_TREND_RULES,'explicit-machine-setting');
 assert.equal(service.read_only,true);
 assert.equal(service.restart,'unless-stopped');
 assert.equal(service.network_mode,undefined);
 assert(service.ports.every(port=>port.host_ip==='127.0.0.1'));
 assert(service.ports.some(port=>port.target===9091));
 assert(service.volumes.every(volume=>volume.read_only&&volume.target==='/run/local-stack'));
 assert.equal(service.depends_on.migrate.condition,'service_completed_successfully');
 assert(!services.account.ports.some(port=>port.target===9092),'the account metrics listener must have no published host port');
});

test('account counts enrich metrics without changing status or hiding operations when acquisition fails',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 let time=100000,fail=false,operationFail=false;
 let counts={version:1,startedAt:1000,series:[{group:'account',outcome:'server_error',total:2,count:2,sum:1,buckets:[0,0,2,2,2,2]}]};
 const sample=snapshot();
 const collection=createCollection({now:()=>time,intervalMs:1000,timeoutMs:2000,
  collect:async()=>{if(operationFail)throw Error();return sample;},
  collectRequests:async()=>{if(fail)throw Error('private URL');return counts;}});
 await collection.poll();assert.deepEqual(collection.status().snapshot,sample);
 assert.match(collection.metrics(),/waitron_cloud_account_requests_available 1\n/);
 assert.match(collection.metrics(),/waitron_cloud_account_requests_total\{group="account",outcome="server_error"\} 2\n/);
 fail=true;await collection.poll();assert.deepEqual(collection.status().snapshot,sample);
 assert.match(collection.metrics(),/waitron_cloud_operations_ready 1\n/);
 assert.match(collection.metrics(),/waitron_cloud_account_requests_available 0\n/);
 assert.doesNotMatch(collection.metrics(),/account_requests_total|private/);
 fail=false;counts={version:1,startedAt:2000,series:[]};await collection.poll();
 assert.match(collection.metrics(),/account_requests_started_timestamp_seconds 2\n/);
 time+=3001;assert.doesNotMatch(collection.metrics(),/account_requests_started_timestamp_seconds/);
 assert.match(collection.metrics(),/account_requests_available 0\n/);
 operationFail=true;await collection.poll();assert.equal(collection.status().snapshot,null);
 assert.doesNotMatch(collection.metrics(),/account_requests_started_timestamp_seconds/);
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

test('overlapping polls are single-flight and incompatible output cannot replace status',{timeout:1000},async()=>{
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

for(const [label,patch] of [
 ['unknown state',{state:'unknown',ready:false}],
 ['inconsistent readiness',{state:'ready',ready:false}],
 ['invalid inspection time',{checkedAt:'not-a-date'}],
])test(`a ${label} result suppresses the previous health sample`,async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 let next=snapshot();const collection=createCollection({collect:async()=>next});
 await collection.poll();assert.equal(collection.status().snapshot.ready,true);
 next={...snapshot(),...patch};await collection.poll();
 assert.equal(collection.status().collection.state,'failed');assert.equal(collection.status().snapshot,null);
 assert.doesNotMatch(collection.metrics(),/waitron_cloud_operations_ready /);
});

test('invalid collection intervals name the setting without starting inspection',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await assert.rejects(promisify(execFile)(process.execPath,[new URL('./operations-collector.mjs',import.meta.url).pathname],{
  env:{PATH:process.env.PATH,CLOUD_OPERATIONS_INTERVAL_MS:'0'},timeout:3000,
 }),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');
  assert.equal(error.stderr,'Local operations collector failed; check CLOUD_OPERATIONS_INTERVAL_MS\n');return true;
 });
});

// Dropping independent acquisition, freshness, or history would misreport an outage or recovery.
test('failure rules are optional and expose only current bounded series',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const failureRules={failureTargets:{account:.1},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
 const counter=new RequestMetrics(1);let time=0,requestFail=false,operationFail=false,readDelay=0;
 const inputs={now:()=>time,intervalMs:1000,timeoutMs:2000,
  collect:async()=>{if(operationFail)throw Error('private database');return snapshot();},
  collectRequests:async()=>{if(requestFail)throw Error('private counts');time+=readDelay;return counter.snapshot();}};
 const disabled=createCollection(inputs);await disabled.poll();
 assert.doesNotMatch(disabled.metrics(),/account_failure_rule/);
 const collection=createCollection({...inputs,failureRules});
 assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/account_failure_rule_breached\{/);
 await collection.poll();
 for(let i=0;i<8;i++)counter.record('account',200);
 counter.record('account',500);counter.record('account',408);time=1000;operationFail=true;
 await collection.poll();
 assert.equal(collection.status().snapshot,null);
 assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 1\n/);
 assert.match(collection.metrics(),/account_failure_rule_breached\{group="account",rule="fast"\} 1\n/);
 assert.doesNotMatch(collection.metrics(),/account_requests_total|private|group="(?:health|parser|portal)"/);
 time=2000;requestFail=true;await collection.poll();
 assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/account_failure_rule_breached\{/);
 // At 4s, slow coverage recovers from 1s despite the missed poll; fast is now clear.
 time=4000;requestFail=false;operationFail=false;readDelay=500;
 for(let i=0;i<100;i++)counter.record('account',200);
 await collection.poll();
 assert.match(collection.metrics(),/account_failure_rule_breached\{group="account",rule="fast"\} 0\n/);
 assert.match(collection.metrics(),/account_failure_rule_breached\{group="account",rule="slow"\} 0\n/);
 time=9499;assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 1\n/);
 time=9500;assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/account_failure_rule_breached\{/);
});

test('invalid rule settings fail before collection with a fixed setting diagnostic',async()=>{
 const {serveCollection}=await import('./operations-collector.mjs');
 let calls=0;const controller=new AbortController();
 await assert.rejects(async()=>{
  const {done}=await serveCollection({collect:async()=>{calls++;return snapshot();},failureRules:'private-invalid',port:0,host:'127.0.0.1',signal:controller.signal});
  controller.abort();await done;
 },{message:'invalid_account_failure_rules'});
 assert.equal(calls,0);
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await assert.rejects(promisify(execFile)(process.execPath,[new URL('./operations-collector.mjs',import.meta.url).pathname],{
  env:{PATH:process.env.PATH,CLOUD_ACCOUNT_FAILURE_RULES:'private-invalid'},timeout:3000,
 }),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');
  assert.equal(error.stderr,'Local operations collector failed; check CLOUD_ACCOUNT_FAILURE_RULES\n');return true;
 });
});

test('configured rules reach the HTTP scrape through service startup',async()=>{
 const {serveCollection}=await import('./operations-collector.mjs');
 const controller=new AbortController();
 const counter=new RequestMetrics(1);
 const failureRules=JSON.stringify({failureTargets:{account:.1},slownessTargets:{account:{limitSeconds:.1,allowance:.2}},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}});
 const trendRules=JSON.stringify({machine:'local-a',limits:Object.fromEntries(['disk','memory','load','email','backup_due'].map(signal=>[signal,{limit:.9,windowMs:1000,horizonMs:3000}]))});
 const {server,done}=await serveCollection({collect:async()=>snapshot(),collectRequests:async()=>counter.snapshot(),collectMachine:async()=>({disk:1,memory:0,load:0}),failureRules,trendRules,intervalMs:1000,port:0,host:'127.0.0.1',signal:controller.signal});
 try{
  const response=await fetch(`http://127.0.0.1:${server.address().port}/metrics`);
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/account_failure_rule_ready\{group="account",rule="fast"\} 0\n/);
  assert.match(body,/account_slowness_rule_ready\{group="account",rule="fast"\} 0\n/);
  assert.match(body,/machine_trend_rule_breached\{machine="local-a",signal="disk"\} 1\n/);
  counter.record('account',200,.2);
  const deadline=Date.now()+4000;let text='';
  while(Date.now()<deadline){
   text=await (await fetch(`http://127.0.0.1:${server.address().port}/metrics`)).text();
   if(/account_slowness_rule_breached\{group="account",rule="fast"\} 1\n/.test(text))break;
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.match(text,/account_slowness_rule_breached\{group="account",rule="fast"\} 1\n/);
 }finally{controller.abort();await done;}
});

test('machine trends keep independent queues and resources through failure, expiry and recovery',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const trendRules={machine:'local-a',limits:Object.fromEntries(['disk','memory','load','email','backup_due'].map(signal=>[signal,{limit:signal==='disk'||signal==='memory'?.9:5,windowMs:1000,horizonMs:signal==='disk'?3000:5000}]))};
 let time=0,inspectionLag=0,operationFail=false,malformed=false,oldest=null,mail=0,due=0,machine={disk:.5,memory:.1,load:0};
 const inputs={now:()=>time,intervalMs:1000,timeoutMs:2000,collectMachine:async()=>machine,collect:async()=>{
  if(operationFail)throw Error('private database');
  if(malformed)return {...snapshot(),components:{}};
  const sample=snapshot();sample.checkedAt=new Date(time-inspectionLag).toISOString();
  Object.assign(sample.components.email,{counts:{...sample.components.email.counts,pending:mail},oldestPendingAt:oldest});
  Object.assign(sample.components.backups,{due,oldestDueAt:oldest});return sample;
 }};
 const disabled=createCollection(inputs);await disabled.poll();assert.doesNotMatch(disabled.metrics(),/machine_trend_rule/);
 const collection=createCollection({...inputs,trendRules});await collection.poll();
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="disk"\} 0\n/);
 time=1000;machine.disk=.6;oldest=new Date(0).toISOString();mail=1;due=1;await collection.poll();
 assert.match(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="disk"\} 1\n/);
 assert.match(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="memory"\} 0\n/);
 assert.match(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="email"\} 1\n/);
 time=2000;operationFail=true;await collection.poll();
 assert.match(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="disk"\} 0\n/);
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="email"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="(?:email|backup_due)"/);
 time=2001;operationFail=false;malformed=true;await collection.poll();malformed=false;
 assert.equal(collection.status().snapshot,null);
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="email"\} 0\n/);
 time=3000;operationFail=false;oldest=new Date(4000).toISOString();due=0;await collection.poll();
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="email"\} 0\n/);
 assert.match(collection.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="backup_due"\} 0\n/);
 time=8000;assert.doesNotMatch(collection.metrics(),/machine_trend_rule_breached\{/);
 time=9000;oldest=new Date(8000).toISOString();machine.memory=null;await collection.poll();
 time=10000;await collection.poll();
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="email"\} 1\n/);
 assert.match(collection.metrics(),/machine_trend_rule_ready\{machine="local-a",signal="memory"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/private/);
 const lagged=createCollection({...inputs,trendRules:{...trendRules,limits:{...trendRules.limits,email:{limit:1.5,windowMs:1000,horizonMs:1}}}});
 mail=1;inspectionLag=1000;time=11000;oldest=new Date(9000).toISOString();await lagged.poll();
 time=12000;oldest=new Date(10000).toISOString();await lagged.poll();
 assert.match(lagged.metrics(),/machine_trend_rule_breached\{machine="local-a",signal="email"\} 0\n/);
});

test('invalid machine trend settings refuse startup with their own diagnostic',async()=>{
 const {serveCollection}=await import('./operations-collector.mjs');let calls=0;const controller=new AbortController();
 await assert.rejects(async()=>{
  const {done}=await serveCollection({collect:async()=>{calls++;return snapshot();},trendRules:'private-invalid',port:0,host:'127.0.0.1',signal:controller.signal});
  controller.abort();await done;
 },{message:'invalid_machine_trend_rules'});
 assert.equal(calls,0);
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await assert.rejects(promisify(execFile)(process.execPath,[new URL('./operations-collector.mjs',import.meta.url).pathname],{env:{PATH:process.env.PATH,CLOUD_MACHINE_TREND_RULES:'private-invalid'},timeout:3000}),error=>{
  assert.equal(error.code,1);assert.equal(error.stdout,'');assert.equal(error.stderr,'Local operations collector failed; check CLOUD_MACHINE_TREND_RULES\n');return true;
 });
});

test('published rule and raw readings survive an unfinished single-flight poll',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const failureRules={failureTargets:{account:.1},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
 let time=0,release,held=true,calls=0,operationFail=false;
 const counter=new RequestMetrics(1);
 const collection=createCollection({now:()=>time,intervalMs:1000,timeoutMs:2000,failureRules,collect:async()=>{if(operationFail)throw Error();return snapshot();},
  collectRequests:async()=>{calls++;if(held)await new Promise(resolve=>{release=resolve;});return counter.snapshot();}});
 const first=collection.poll();await new Promise(resolve=>setImmediate(resolve));
 try{assert.equal(collection.status().collection.state,'pending');}finally{held=false;release();await first;}
 time=1000;counter.record('account',500);await collection.poll();
 time=2000;operationFail=true;held=true;counter.record('account',200);
 const pending=collection.poll();await new Promise(resolve=>setImmediate(resolve));
 try{
  await collection.poll();assert.equal(calls,3,'the pending account read must keep the poll single-flight');
  assert.equal(collection.status().collection.state,'current');
  const text=collection.metrics();
  assert.match(text,/account_requests_total\{group="account",outcome="server_error"\} 1\n/);
  assert.match(text,/account_failure_rule_breached\{group="account",rule="fast"\} 1\n/);
  assert.doesNotMatch(text,/outcome="success"/,'the unfinished read must not publish its newer counts');
 }finally{held=false;release();await pending;}
 assert.equal(collection.status().snapshot,null);
 assert.doesNotMatch(collection.metrics(),/account_requests_total/);
});

test('failure rule metric families remain contiguous and typed',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const failureRules={failureTargets:{account:.1,portal:.1},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
 let time=0;const counter=new RequestMetrics(1);
 const collection=createCollection({now:()=>time,intervalMs:1000,failureRules,collect:async()=>snapshot(),collectRequests:async()=>counter.snapshot()});
 await collection.poll();time=3000;counter.record('account',500);counter.record('portal',200);await collection.poll();
 const lines=collection.metrics().split('\n').filter(line=>line.includes('account_failure_rule'));
 const families=[];
 for(const line of lines){
  const name=line.match(/(?:# TYPE )?(waitron_cloud_account_failure_rule_\w+)/)[1];
  if(name!==families.at(-1))families.push(name);
 }
 assert.deepEqual(families,['waitron_cloud_account_failure_rule_ready','waitron_cloud_account_failure_rule_breached']);
 assert.equal(lines[0],'# TYPE waitron_cloud_account_failure_rule_ready gauge');
 assert.equal(lines[5],'# TYPE waitron_cloud_account_failure_rule_breached gauge');
 assert.equal(lines.length,10);
});

test('rule freshness covers a timeout inspection and the following bounded account read',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const failureRules={failureTargets:{account:.1},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
 let time=0,slow=false,midReadMetrics;const counter=new RequestMetrics(1);
 const collection=createCollection({now:()=>time,intervalMs:1000,timeoutMs:30000,failureRules,
  collect:async()=>{if(slow){time+=30000;throw Error();}return snapshot();},
  collectRequests:async()=>{
   if(slow){time+=1999;midReadMetrics=collection.metrics();}
   return counter.snapshot();
  }});
 await collection.poll();time=1000;counter.record('account',500);await collection.poll();
 time=2000;slow=true;counter.record('account',500);await collection.poll();
 assert.equal(time,33999);
 assert.match(midReadMetrics,/account_failure_rule_ready\{group="account",rule="fast"\} 1\n/);
 assert.match(collection.metrics(),/account_failure_rule_breached\{group="account",rule="fast"\} 1\n/);
 time=66999;assert.match(collection.metrics(),/account_failure_rule_ready\{group="account",rule="fast"\} 0\n/);
});


test('slowness is shown beside failure with shared freshness and grouped metrics',async()=>{
 const {createCollection}=await import('./operations-collector.mjs');
 const failureRules={failureTargets:{account:.1},slownessTargets:{account:{limitSeconds:.1,allowance:.2}},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
 let time=0;const counter=new RequestMetrics(1);
 const collection=createCollection({now:()=>time,intervalMs:1000,timeoutMs:2000,failureRules,
  collect:async()=>snapshot(),collectRequests:async()=>counter.snapshot()});
 await collection.poll();counter.record('account',200,.2);time=1000;await collection.poll();
 const text=collection.metrics();
 assert.match(text,/account_failure_rule_breached\{group="account",rule="fast"\} 0\n/);
 assert.match(text,/account_slowness_rule_breached\{group="account",rule="fast"\} 1\n/);
 assert.doesNotMatch(text,/account_slowness_rule_breached\{group="account",rule="slow"/);
 assert.match(text,/# TYPE waitron_cloud_account_slowness_rule_ready gauge\n(?:waitron_cloud_account_slowness_rule_ready[^\n]+\n){2}# TYPE waitron_cloud_account_slowness_rule_breached gauge\n/);
 time=6000;
 assert.match(collection.metrics(),/account_slowness_rule_ready\{group="account",rule="fast"\} 0\n/);
 assert.doesNotMatch(collection.metrics(),/account_slowness_rule_breached\{/);
});
