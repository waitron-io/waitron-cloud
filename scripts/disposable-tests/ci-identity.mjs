import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const runnerCommand=['/opt/actions-runner/bin/Runner.Listener','run'];
export function ciIdentity(value) {
  const keys=['repositoryId','workflowId','workflowPath','workflowSha','workflowDigest','event','sourceSha','sourceTree','runId','attempt','jobId','jobKey'];
  assert.ok(value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',')===[...keys].sort().join(','),'Invalid CI identity fields');
  for(const key of ['repositoryId','workflowId','runId','attempt','jobId'])
    assert.ok(Number.isSafeInteger(value[key]) && value[key]>0,'Invalid CI numeric identity');
  assert.ok(['.github/workflows/disposable-ci-canary.yml','.github/workflows/ci.yml'].includes(value.workflowPath) &&
    ['workflow_dispatch','pull_request'].includes(value.event) && typeof value.jobKey==='string' && /^(typecheck|test-dashboard-[1-4]|test-server-([1-9]|1[0-9]|2[0-4])|test-heavy-[1-3])$/.test(value.jobKey),'Invalid CI workflow identity');
  for(const key of ['workflowSha','sourceSha','sourceTree']) assert.match(value[key],/^[a-f0-9]{40}$/,'Invalid CI Git identity');
  assert.match(value.workflowDigest,/^[a-f0-9]{64}$/,'Invalid CI workflow digest');
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
export const ciSnapshot=value=>createHash('sha256').update(JSON.stringify(ciIdentity(value))).digest('hex');
export const runnerName=value=>{const ci=ciIdentity(value);return `dt-${ci.repositoryId}-${ci.runId}-${ci.attempt}-${ci.jobId}`;};
export const routingLabel=value=>{const ci=ciIdentity(value);return `dt-${ci.repositoryId}-${ci.runId}-${ci.attempt}-${ci.jobKey}`;};
export function ciRequest(lane,value){const ci=ciIdentity(value);return {lane,turn:`ci-${ci.runId}-${ci.attempt}`,snapshot:ciSnapshot(ci),argv:[...runnerCommand],ci};}
export function orphanRunner(value) {
  assert.ok(value && Object.keys(value).sort().join(',')==='ci,runnerId,runnerName','Invalid orphan runner fields');
  ciIdentity(value.ci);
  assert.ok(value.runnerName===runnerName(value.ci) && (value.runnerId===null ||
    Number.isSafeInteger(value.runnerId) && value.runnerId>0),'Invalid orphan runner identity');
  return value;
}

export function ciInvocation(value){
 assert.ok(value && Object.keys(value).filter(key=>key!=='serverRunnerId').sort().join(',')==='attempt,createdAt,nonce,route,runId,sourceSha,workflowSha','Invalid CI invocation fields');
 if(value.serverRunnerId!==undefined)assert.ok(value.route==='server' && Number.isSafeInteger(value.serverRunnerId) && value.serverRunnerId>0,'Invalid completed CI runner');
 assert.match(value.nonce,/^[a-f0-9]{32}$/,'Invalid CI invocation nonce');
 for(const key of ['sourceSha','workflowSha'])assert.match(value[key],/^[a-f0-9]{40}$/,'Invalid CI invocation Git identity');
 assert.ok(['hosted','server'].includes(value.route) && Number.isSafeInteger(value.createdAt) && value.createdAt>=0 &&
  ((value.runId===null && value.attempt===null) || [value.runId,value.attempt].every(v=>Number.isSafeInteger(v)&&v>0)), 'Invalid CI invocation identity');
 return value;
}

export function jobName(value){
 const ci=ciIdentity(value);if(ci.jobKey==='typecheck')return 'typecheck';
 const match=/^(test-(?:dashboard|server|heavy))-([0-9]+)$/.exec(ci.jobKey);return `${match[1]} (${match[2]})`;
}
