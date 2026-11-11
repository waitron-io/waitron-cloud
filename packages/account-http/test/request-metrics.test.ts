import assert from 'node:assert/strict';
import test from 'node:test';
import {RequestMetrics,requestGroup,formatRequestMetrics,parseRequestMetrics} from '../src/request-metrics.ts';

test('route groups use segment boundaries and never retain private request values',()=>{
 for(const [path,portal,want] of [
  ['/api/health/live',false,'health'],['/api/%61ccount/session?token=private',false,'account'],
  ['/api/accounting/private',false,'other'],['/api/installations/private/translation',false,'installations'],
  ['/v1/installations/email/submit',true,'relay'],['/account?email=private',true,'portal'],
  ['/api/private?token=private',true,'other'],['/private',false,'other'],['/%ff',false,'other'],
  ['/api/account/../health/live',false,'health'],['http://localhost/api/health/live',true,'health'],['/api/%2e%2e/signup',true,'portal'],
 ] as const)assert.equal(requestGroup(path,portal),want,path);
});

test('each Prometheus metric family keeps its metadata and samples in one contiguous group',()=>{
 const metrics=new RequestMetrics(1000);metrics.record('health',200,.1);metrics.record('account',503,1);
 const blocks=formatRequestMetrics(metrics.snapshot()).split(/(?=# TYPE )/).filter(block=>block.startsWith('# TYPE '));
 assert.equal(blocks.length,3);
 for(const name of ['waitron_cloud_account_requests_started_timestamp_seconds','waitron_cloud_account_requests_total','waitron_cloud_account_request_duration_seconds']){
  const block=blocks.find(value=>value.startsWith('# TYPE '+name+' '));assert(block);
  const samples=block.trim().split('\n').filter(line=>!line.startsWith('#'));
  assert(samples.length>0);for(const sample of samples)assert(sample.startsWith(name),sample);
 }
});

test('counts classify wire status and cumulative timings include exact boundaries',()=>{
 const metrics=new RequestMetrics(100000);
 for(const [status,seconds] of [[200,.05],[302,.1],[400,.5],[429,1],[503,5],[408,6]] as const)metrics.record('account',status,seconds);
 metrics.record('parser',400);
 const value=parseRequestMetrics(metrics.snapshot());
 assert.equal(value.startedAt,100000);
 const success=value.series.find(row=>row.group==='account'&&row.outcome==='success')!;
 assert(Math.abs(success.sum-.15)<1e-12);
 assert.deepEqual({...success,sum:undefined},{
  group:'account',outcome:'success',total:2,count:2,sum:undefined,buckets:[1,2,2,2,2,2],
 });
 assert.deepEqual(value.series.find(row=>row.group==='parser'),{
  group:'parser',outcome:'refused',total:1,count:0,sum:0,buckets:[0,0,0,0,0,0],
 });
 const text=formatRequestMetrics(value);
 assert.match(text,/waitron_cloud_account_requests_total\{group="account",outcome="refused"\} 2\n/);
 assert.match(text,/waitron_cloud_account_request_duration_seconds_bucket\{group="account",outcome="timed_out",le="\+Inf"\} 1\n/);
 assert.match(text,/waitron_cloud_account_requests_started_timestamp_seconds 100\n/);
 assert.doesNotMatch(text,/private/);
 assert.doesNotMatch(formatRequestMetrics(new RequestMetrics(101000).snapshot()),/group=/);
});

test('untrusted metric snapshots reject private labels and inconsistent or nonfinite counters',()=>{
 const metrics=new RequestMetrics(100000);metrics.record('health',200,.1);
 const original=metrics.snapshot();
 for(const change of [
  {group:'private'},{outcome:'private'},{total:Infinity},{count:-1},{sum:NaN},{total:0},
  {buckets:[1,0,1,1,1,1]},{buckets:[0,1,1,1,1,2]},{extra:'private'},
 ])assert.throws(()=>parseRequestMetrics({...original,series:[{...original.series[0],...change}]}));
 assert.throws(()=>parseRequestMetrics({...original,series:[original.series[0],original.series[0]]}));
 assert.throws(()=>parseRequestMetrics({...original,startedAt:NaN}));
 assert.throws(()=>parseRequestMetrics({...original,secret:'private'}));
});
