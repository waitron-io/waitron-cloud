import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RequestMetrics} from '../../packages/account-http/src/request-metrics.ts';

const settings={failureTargets:{account:.1,portal:.05},fast:{windowMs:1000,multiplier:2},slow:{windowMs:3000,multiplier:1}};
function counts(rows=[],startedAt=1){
 const metrics=new RequestMetrics(startedAt);
 for(const [group,status,total] of rows)for(let i=0;i<total;i++)metrics.record(group,status);
 return metrics.snapshot();
}
const view=rows=>rows.map(({group,rule,ready,breached})=>[group,rule,ready,breached]);

test('rules require complete explicit settings',async()=>{
 const {parseFailureRules}=await import('./account-failure-rules.mjs');
 assert.equal(parseFailureRules(undefined,1000),null);assert.equal(parseFailureRules('',1000),null);
 assert.deepEqual(parseFailureRules(JSON.stringify(settings),1000),settings);
 for(const invalid of ['private-invalid',{}, {...settings,extra:1}, {...settings,failureTargets:{}},
  {...settings,failureTargets:{privateGroup:.1}}, {...settings,failureTargets:{account:0}},
  {...settings,failureTargets:{account:1.1}}, {...settings,failureTargets:{account:'0.1'}}, {...settings,failureTargets:{account:null}},
  {...settings,fast:{windowMs:999,multiplier:2}}, {...settings,fast:{windowMs:1000.5,multiplier:2}},
  {...settings,fast:{windowMs:1000}}, {...settings,fast:{windowMs:1000,multiplier:'2'}}, {...settings,slow:{windowMs:3000,multiplier:0}},
  {...settings,slow:{windowMs:3000,multiplier:1,extra:1}}, {...settings,slow:null}]){
  assert.throws(()=>parseFailureRules(JSON.stringify(invalid),1000),{message:'invalid_account_failure_rules'});
 }
 assert.throws(()=>parseFailureRules('{private-invalid',1000),{message:'invalid_account_failure_rules'});
 assert.deepEqual(parseFailureRules(JSON.stringify({...settings,failureTargets:{parser:1},slow:{windowMs:1000,multiplier:100}}),1000).failureTargets,{parser:1});
});

test('counter differences distinguish fast and slow boundaries per group and clear',async()=>{
 const {createFailureRules}=await import('./account-failure-rules.mjs');
 const rules=createFailureRules(settings,{intervalMs:1000,timeoutMs:2000});
 rules.update(counts([['account',500,40]]),0);
 assert.deepEqual(view(rules.update(counts([['account',500,40],['account',403,10]]),1000)),[
  ['account','fast',true,false],['account','slow',false,null],['portal','fast',false,null],['portal','slow',false,null]]);
 // Newly observed timeout counters count as failures; refused responses dilute their share.
 assert.deepEqual(view(rules.update(counts([['account',500,40],['account',403,17],['account',408,3],['portal',500,1]]),2000)),[
  ['account','fast',true,true],['account','slow',false,null],['portal','fast',true,true],['portal','slow',false,null]]);
 assert.deepEqual(view(rules.update(counts([['account',500,40],['account',403,27],['account',408,3],['portal',500,1]]),3000)),[
  ['account','fast',true,false],['account','slow',true,true],['portal','fast',false,null],['portal','slow',true,true]]);
 assert.deepEqual(view(rules.update(counts([['account',500,40],['account',403,47],['account',408,3],['portal',500,1]]),5000)),[
  ['account','fast',true,false],['account','slow',true,false],['portal','fast',false,null],['portal','slow',false,null]]);
});

test('exact decimal thresholds breach but genuinely lower shares do not',async()=>{
 const {createFailureRules}=await import('./account-failure-rules.mjs');
 for(const [failures,want] of [[3,true],[2,false]]){
  const rules=createFailureRules({...settings,failureTargets:{account:.0001},fast:{windowMs:1000,multiplier:3}},{intervalMs:1000,timeoutMs:2000});
  rules.update(counts(),0);
  assert.equal(rules.update(counts([['account',500,failures],['account',200,10000-failures]]),1000)[0].breached,want);
 }
});

test('startup and empty windows stay unknown; old baselines cannot imply health',async()=>{
 const {createFailureRules}=await import('./account-failure-rules.mjs');
 const rules=createFailureRules({...settings,failureTargets:{account:.1}},{intervalMs:1000,timeoutMs:2000});
 assert.deepEqual(view(rules.update(counts(),0)),[['account','fast',false,null],['account','slow',false,null]]);
 assert.deepEqual(view(rules.update(counts(),3000)),[['account','fast',false,null],['account','slow',false,null]]);
 assert.deepEqual(view(rules.update(counts([['account',500,1]]),11001)),[['account','fast',false,null],['account','slow',false,null]]);
});

test('process resets discard unrelated counters while missed polls retain coverage',async()=>{
 const {createFailureRules}=await import('./account-failure-rules.mjs');
 for(const [label,startedAt,at,total] of [['restart',2,7000,20],['decrease',1,7000,5],['backward time',1,5999,20]]){
  const rules=createFailureRules({...settings,failureTargets:{account:.1}},{intervalMs:1000,timeoutMs:2000});
  rules.update(counts(),0);
  // A baseline exactly interval + timeout + 2s before the window still covers missed polls.
  assert.deepEqual(view(rules.update(counts([['account',500,10]]),6000)),[['account','fast',true,true],['account','slow',true,true]]);
  assert.deepEqual(view(rules.update(counts([['account',500,total]],startedAt),at)),[['account','fast',false,null],['account','slow',false,null]],label);
 }
});

test('slowness requires explicit measured-group targets and shares existing windows',async()=>{
 const {parseFailureRules}=await import('./account-failure-rules.mjs');
 const config={...settings,slownessTargets:{account:{limitSeconds:.1,allowance:.2}}};
 assert.deepEqual(parseFailureRules(JSON.stringify(config),1000),config);
 for(const slownessTargets of [{},null,[],{parser:{limitSeconds:.1,allowance:.2}},
  {account:{limitSeconds:.2,allowance:.2}},{account:{limitSeconds:5}},
  {account:{allowance:.2}},{account:{limitSeconds:.1,allowance:0}},
  {account:{limitSeconds:.1,allowance:1.1}},{account:{limitSeconds:'.1',allowance:.2}},
  {account:{limitSeconds:.1,allowance:'0.2'}},{account:{limitSeconds:.1,allowance:.2,extra:1}}])
  assert.throws(()=>parseFailureRules(JSON.stringify({...config,slownessTargets}),1000),{message:'invalid_account_failure_rules'});
});

test('slowness shares use measured counts and strict boundaries for every timing band',async()=>{
 const {createSlownessRules}=await import('./account-failure-rules.mjs');
 assert.equal(typeof createSlownessRules,'function');
 for(const limitSeconds of [.05,.1,.5,1,5])for(const [allowance,breached] of [[.5,true],[.50001,false]]){
  const config={slownessTargets:{account:{limitSeconds,allowance}},fast:{windowMs:1000,multiplier:1},slow:{windowMs:3000,multiplier:1}};
  const rules=createSlownessRules(config,{intervalMs:1000,timeoutMs:2000}),counter=new RequestMetrics(1);
  rules.update(counter.snapshot(),0);
  for(const status of [200,403,500,408]){
   counter.record('account',status,limitSeconds);counter.record('account',status,limitSeconds+.001);
   counter.record('account',status);counter.record('portal',status,10);
  }
  assert.deepEqual(view(rules.update(counter.snapshot(),1000)),[['account','fast',true,breached],['account','slow',false,null]]);
  for(let i=0;i<8;i++)counter.record('account',200,limitSeconds);
  assert.deepEqual(view(rules.update(counter.snapshot(),3000)),[['account','fast',true,false],['account','slow',true,false]]);
 }
});

test('decreasing measured counts or selected buckets starts new slowness coverage',async()=>{
 const {createSlownessRules}=await import('./account-failure-rules.mjs');
 assert.equal(typeof createSlownessRules,'function');
 for(const changed of ['count','bucket']){
  const config={slownessTargets:{account:{limitSeconds:.1,allowance:.2}},fast:{windowMs:1000,multiplier:1},slow:{windowMs:3000,multiplier:1}};
  const rules=createSlownessRules(config,{intervalMs:1000,timeoutMs:2000}),counter=new RequestMetrics(1);
  rules.update(counter.snapshot(),0);
  for(let i=0;i<10;i++)counter.record('account',200,i<5?.1:.2);
  assert.equal(rules.update(counter.snapshot(),1000)[0].breached,true);
  const next=counter.snapshot(),row=next.series[0];
  if(changed==='count'){row.count=9;row.buckets=row.buckets.map(n=>Math.min(n,9));}else row.buckets[1]=4;
  assert.deepEqual(view(rules.update(next,2000)),[['account','fast',false,null],['account','slow',false,null]],changed);
  for(let i=0;i<6;i++)counter.record('account',200,.2);
  assert.deepEqual(view(rules.update(counter.snapshot(),4000))[1],['account','slow',false,null],changed);
 }
});

const trendSettings={machine:'local-a',limits:Object.fromEntries(['disk','memory','load','email','backup_due'].map(signal=>[signal,{limit:signal==='disk'||signal==='memory'?.9:10,windowMs:1000,horizonMs:60000}]))};
test('machine trends require explicit per-signal limits, windows and horizons',async()=>{
 const {parseTrendRules}=await import('./account-failure-rules.mjs');
 assert.equal(typeof parseTrendRules,'function');
 assert.equal(parseTrendRules(undefined,1000),null);assert.equal(parseTrendRules('',1000),null);
 assert.deepEqual(parseTrendRules(JSON.stringify(trendSettings),1000),trendSettings);
 for(const invalid of [{},null,[],{...trendSettings,extra:1},{...trendSettings,machine:'private.example'},
  {...trendSettings,machine:'a'.repeat(33)},{...trendSettings,limits:{}},
  ...[{limit:0,windowMs:1000,horizonMs:1},{limit:1.1,windowMs:1000,horizonMs:1},
   {limit:.9,windowMs:999,horizonMs:1},{limit:.9,windowMs:1000.5,horizonMs:1},
   {limit:.9,windowMs:1000,horizonMs:0},{limit:.9,windowMs:1000,horizonMs:'1'},
   {limit:.9,windowMs:1000},{limit:.9,windowMs:1000,horizonMs:1,extra:1}]
   .map(disk=>({...trendSettings,limits:{...trendSettings.limits,disk}}))])
  assert.throws(()=>parseTrendRules(JSON.stringify(invalid),1000),{message:'invalid_machine_trend_rules'});
 assert.throws(()=>parseTrendRules('private-invalid',1000),{message:'invalid_machine_trend_rules'});
});

test('machine trends distinguish a growth horizon, current limits and falling readings',async()=>{
 const {createTrendRules}=await import('./account-failure-rules.mjs');
 assert.equal(typeof createTrendRules,'function');
 const config={machine:'local-a',limits:{disk:{limit:.9,windowMs:1000,horizonMs:3000},memory:{limit:.9,windowMs:3000,horizonMs:1000},
  load:{limit:2,windowMs:1000,horizonMs:1000},email:{limit:10,windowMs:1000,horizonMs:1000},backup_due:{limit:10,windowMs:1000,horizonMs:1000}}};
 const rules=createTrendRules(config,{intervalMs:1000,timeoutMs:2000});
 const update=(at,values)=>rules.update(Object.fromEntries(Object.entries(values).map(([signal,value])=>[signal,{value,at}])),at).map(({signal,ready,breached})=>[signal,ready,breached]);
 assert.deepEqual(update(0,{disk:.5,memory:.9,load:2,email:0,backup_due:10}),[
  ['disk',false,null],['memory',true,true],['load',true,true],['email',false,null],['backup_due',true,true]]);
 assert.deepEqual(update(1000,{disk:.6,memory:.8,load:1,email:5,backup_due:1}),[
  ['disk',true,true],['memory',false,null],['load',true,false],['email',true,true],['backup_due',true,false]]);
 assert.deepEqual(update(2000,{disk:.59999,memory:.7,load:1,email:0,backup_due:0}),[
  ['disk',true,false],['memory',false,null],['load',true,false],['email',true,false],['backup_due',true,false]]);
});

test('missing machine signals recover independently and backward time discards coverage',async()=>{
 const {createTrendRules}=await import('./account-failure-rules.mjs');
 assert.equal(typeof createTrendRules,'function');
 const rules=createTrendRules(trendSettings,{intervalMs:1000,timeoutMs:2000});
 rules.update({disk:{value:.1,at:0},memory:{value:.1,at:0}},0);
 assert.equal(rules.update({disk:{value:.2,at:1000},memory:{value:.2,at:1000}},1000)[0].ready,true);
 assert.deepEqual(rules.update({disk:{value:1,at:5000}},2000).slice(0,1).map(({ready,breached})=>[ready,breached]),[[false,null]]);
 const missing=rules.update({disk:{value:1,at:-10000},memory:{value:1,at:2000}},2000);
 assert.deepEqual(missing.slice(0,2).map(({ready,breached})=>[ready,breached]),[[false,null],[true,true]]);
 const recovered=rules.update({disk:{value:.1,at:7001},memory:{value:.1,at:7001}},7001);
 assert.deepEqual(recovered.slice(0,2).map(({ready,breached})=>[ready,breached]),[[false,null],[true,false]]);
 assert.equal(rules.update({memory:{value:.1,at:500}},500)[1].ready,false);
});
