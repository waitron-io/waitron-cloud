import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {LocalLeases} from './leases.mjs';

const ci={repositoryId:123,workflowId:456,workflowPath:'.github/workflows/disposable-ci-canary.yml',
  workflowSha:'1'.repeat(40),workflowDigest:'2'.repeat(64),event:'workflow_dispatch',
  sourceSha:'3'.repeat(40),sourceTree:'4'.repeat(40),runId:789,attempt:1,jobId:901,jobKey:'typecheck'};
const canonical=()=>({lane:'I',turn:'ci-789-1-901',snapshot:createHash('sha256').update(JSON.stringify(ci)).digest('hex'),
  argv:['/opt/actions-runner/bin/Runner.Listener','run'],ci:{...ci}});
function setup(t){const root=mkdtempSync(join(tmpdir(),'ci-leases-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 return new LocalLeases(join(root,'ledger'),{hostGeneration:'bridge-1',slots:1,bootstrap:true});}

test('CI admission persists exact job identity and rejects a changed job on replay',t=>{
 const leases=setup(t),first=leases.reserveLocal(canonical());
 assert.deepEqual(first.lease.ci,ci);
 assert.equal(leases.reserveLocal(canonical()).created,false);
 assert.throws(()=>leases.reserveLocal({...canonical(),ci:{...ci,jobId:902}}),/CI|identity|different/i);
});

test('CI identity cannot borrow a local snapshot, turn or executable',t=>{
 const leases=setup(t);
 for(const bad of [{snapshot:'a'.repeat(64)},{turn:'local-1'},{argv:['sh','-c','true']},
   {ci:{...ci,attempt:0}},{ci:{...ci,jobId:'901'}},{ci:{...ci,extra:true}},
   {ci:{...ci,workflowPath:'../ci.yml'}},{ci:{...ci,event:'pull_request_target'}}])
   assert.throws(()=>leases.reserveLocal({...canonical(),...bad}),/CI|identity/i);
 assert.equal(leases.inspect().slots[0].state,'free');
});

test('verified VM absence frees manual capacity while retaining orphan runner cleanup',t=>{
 const leases=setup(t),lease=leases.reserveLocal(canonical()).lease;
 leases.start(lease);
 assert.equal(leases.release(lease,{resourceId:lease.resourceId,absent:true}),true);
 assert.deepEqual(leases.inspect().orphanRunners,[{ci,runnerName:'dt-123-789-1-901',runnerId:null}]);
 assert.equal(leases.reserveLocal({lane:'H',turn:'manual-2',snapshot:'b'.repeat(64),argv:['true']}).code,0);
});

test('malformed orphan metadata refuses ledger use without discarding its contents',t=>{
 const leases=setup(t),path=join(leases.directory,'state.json');
 const state=leases.inspect();state.orphanRunners=[{ci,runnerName:'foreign',runnerId:null}];
 const before=JSON.stringify(state);writeFileSync(path,before);
 assert.throws(()=>leases.inspect(),/orphan|runner/i);assert.equal(readFileSync(path,'utf8'),before);
});

test('returned runner ID is durable before execution and stale identity cannot overwrite it',t=>{
 const leases=setup(t),lease=leases.reserveLocal(canonical()).lease;
 assert.equal(typeof leases.bindRunner,'function','The concrete runner needs durable binding');
 assert.equal(leases.bindRunner(lease,1001),true);assert.equal(lease.runnerId,1001);
 assert.equal(leases.inspect().slots[0].lease.runnerId,1001);
 assert.equal(leases.bindRunner({...lease,generation:2},1002),false);
 leases.release(lease,{resourceId:lease.resourceId,absent:true});
 assert.equal(leases.inspect().orphanRunners[0].runnerId,1001);
});
test('dispatch identity is persisted before API calls and stale cleanup cannot erase a successor',t=>{
 const leases=setup(t),invocation={nonce:'a'.repeat(32),sourceSha:'3'.repeat(40),workflowSha:'1'.repeat(40),route:'server',createdAt:1000,runId:null,attempt:null};
 assert.equal(typeof leases.setInvocation,'function','Dispatch needs recoverable identity');
 leases.setInvocation(invocation);assert.deepEqual(leases.inspect().ciInvocation,invocation);
 leases.setInvocation({...invocation,runId:789,attempt:1});
 assert.equal(leases.clearInvocation('b'.repeat(32)),false);assert.equal(leases.inspect().ciInvocation.runId,789);
 assert.equal(leases.clearInvocation(invocation.nonce),true);
 assert.equal(leases.inspect().ciInvocation,undefined);
});
test('the same one-job lease accepts the requested Waitron measurement shards and refuses unknown shards',async t=>{
 const {ciRequest}=await import('./ci-identity.mjs');
 for(const jobKey of ['test-dashboard-1','test-dashboard-4','test-server-1','test-server-24','test-heavy-1','test-heavy-3']){
  const leases=setup(t),identity={...ci,workflowPath:'.github/workflows/ci.yml',jobKey};
  const result=leases.reserveLocal(ciRequest('I',identity));assert.equal(result.code,0);assert.equal(result.lease.ci.jobKey,jobKey);
 }
 for(const jobKey of ['test-dashboard-5','test-server-25','test-heavy-4','publish','../test-dashboard-1'])
  assert.throws(()=>ciRequest('I',{...ci,workflowPath:'.github/workflows/ci.yml',jobKey}));
});

// A run has several simultaneous jobs; using only run/attempt collides their turns.
test('several jobs from one CI attempt keep separate leases and runner cleanup',async t=>{
 const {ciRequest}=await import('./ci-identity.mjs');
 const root=mkdtempSync(join(tmpdir(),'ci-concurrent-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'bridge-1',slots:4,bootstrap:true});
 const firstSlot=new LocalLeases(leases.directory,{hostGeneration:'bridge-1',slots:4,slot:0}),secondSlot=new LocalLeases(leases.directory,{hostGeneration:'bridge-1',slots:4,slot:1});
 const first=firstSlot.reserveLocal(ciRequest('I',ci));
 const secondCI={...ci,jobId:902};
 const second=secondSlot.reserveLocal(ciRequest('I',secondCI));
 assert.equal(first.code,0);assert.equal(second.code,0);
 assert.equal(first.lease.turn,'ci-789-1-901');assert.equal(second.lease.turn,'ci-789-1-902');
 assert.equal(first.lease.slot,0);assert.equal(second.lease.slot,1);
 assert.equal(leases.start(first.lease),true);assert.equal(leases.start(second.lease),true);
 assert.equal(firstSlot.release(first.lease,{resourceId:first.lease.resourceId,absent:true}),true);
 assert.equal(leases.inspect().slots[1].state,'running');
 assert.equal(firstSlot.inspect().orphanRunners[0].runnerName,'dt-123-789-1-901');
});

// An old completed attempt must not gain a new turn just because its naming changed.
test('a retained legacy CI turn prevents a new-format replay of the same attempt',async t=>{
 const {ciRequest}=await import('./ci-identity.mjs');const leases=setup(t),path=join(leases.directory,'state.json');const state=leases.inspect();
 state.slots[0].generation=1;state.turns['I:ci-789-1']={fingerprint:'c'.repeat(64),slot:0,generation:1};const before=JSON.stringify(state);writeFileSync(path,before);
 assert.equal(leases.reserveLocal(ciRequest('I',ci)).code,75);assert.equal(readFileSync(path,'utf8'),before);
});

test('multi-slot CI reservation refuses a caller without a selected slot',async t=>{
 const {ciRequest}=await import('./ci-identity.mjs');const root=mkdtempSync(join(tmpdir(),'ci-scope-required-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const leases=new LocalLeases(join(root,'ledger'),{hostGeneration:'bridge-1',slots:4,bootstrap:true});
 assert.throws(()=>leases.reserveLocal(ciRequest('I',ci)),/scoped|slot/i);assert.ok(leases.inspect().slots.every(s=>s.state==='free'));
});

// A mismatched bounded key or API name would prevent the intended guest from receiving its job.
test('the approved till and unsharded UI keys retain exact routing labels and API names',async()=>{
 const {ciIdentity,routingLabel,jobName}=await import('./ci-identity.mjs');
 for(const [key,name] of [['test-till-1','test-till (1)'],['test-till-7','test-till (7)'],['test-ui-1','test-ui']]){
  const identity=ciIdentity({...ci,workflowPath:'.github/workflows/ci.yml',jobKey:key});
  assert.equal(jobName(identity),name);assert.equal(routingLabel(identity),'dt-123-789-1-'+key);
 }
});

// Permitting an extra shard or a trailing line break would no longer name a reviewed routing label.
test('till and UI admission refuse unselected families, extra shards and noncanonical keys',async()=>{
 const {ciIdentity}=await import('./ci-identity.mjs');
 for(const jobKey of ['test-till-0','test-till-8','test-till-01','test-ui-0','test-ui-2','test-ui','test-setup-2','test-dashboard-1\n','test-server-1\r','test-till-1\n'])
  assert.throws(()=>ciIdentity({...ci,workflowPath:'.github/workflows/ci.yml',jobKey}),/Invalid CI workflow identity/);
});

// Unsharded jobs use a -1 label; each matrix keeps its approved shard range.
test('newly routed ordinary families keep their exact GitHub names and routing labels',async()=>{
 const {ciIdentity,routingLabel,jobName}=await import('./ci-identity.mjs');
 for(const [jobKey,name] of [
  ['lint-1','lint'],['root-guards-1','root-guards'],['bundle-smoke-1','bundle-smoke'],['typecheck-1','typecheck'],
  ['test-setup-1','test-setup'],['test-staffing-1','test-staffing'],['test-bookings-1','test-bookings'],['test-media-1','test-media'],
  ['test-payments-stripe-1','test-payments-stripe'],['test-payments-sumup-1','test-payments-sumup'],['test-identity-1','test-identity'],['test-workforce-1','test-workforce'],
  ['test-light-a-1','test-light-a'],['test-light-b-1','test-light-b'],
  ['test-fiscal-verifactu-1','test-fiscal-verifactu (1)'],['test-fiscal-verifactu-4','test-fiscal-verifactu (4)'],
  ['test-provisioning-1','test-provisioning (1)'],['test-provisioning-6','test-provisioning (6)'],['mutation-shared-1','mutation-shared (1)'],['mutation-shared-4','mutation-shared (4)'],
  ['test-venue-service-1','test-venue-service (1)'],['test-venue-service-2','test-venue-service (2)'],['test-venue-service-3','test-venue-service (3)'],['test-venue-service-4','test-venue-service (4)'],['test-adjustments-1','test-adjustments']]){
  const identity=ciIdentity({...ci,workflowPath:'.github/workflows/ci.yml',event:'pull_request',jobKey});
  assert.equal(jobName(identity),name);assert.equal(routingLabel(identity),'dt-123-789-1-'+jobKey);
 }
});

test('routed keys still refuse extra shards and malformed job labels',async()=>{
 const {ciIdentity}=await import('./ci-identity.mjs');
 for(const jobKey of ['lint-2','root-guards-2','typecheck-2','test-setup-2','test-fiscal-verifactu-5','test-provisioning-7','mutation-shared-5','test-venue-service-5','test-adjustments-2',
  'test-server-stream-2','mutation-shared-aggregate-2','test-server-merge-2','test-till-merge-2','test-dashboard-merge-2','test-light-a-01','test-bookings-1\n'])
  assert.throws(()=>ciIdentity({...ci,workflowPath:'.github/workflows/ci.yml',jobKey}),/Invalid CI workflow identity/);
});
