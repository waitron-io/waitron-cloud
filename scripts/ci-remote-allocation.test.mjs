import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadWorkspace,workPlan} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';
import {packageMembers} from './ci-package-groups.mjs';
const remote='@waitron-cloud/remote-access';
const rows=[1,2,3,4].map(shard=>({package:remote,shard,shards:4}));

test('planner allocates four independent remote jobs without repeating a grouped remote suite',()=>{
 const workspace=loadWorkspace();
 assert.deepEqual(workPlan({full:false,packages:[remote]},workspace).packages,rows);
 const full=workPlan({full:true,packages:workspace.map(p=>p.name)},workspace);
 assert.deepEqual(full.packages.filter(r=>r.package===remote),rows);
 assert.equal(full.packages.some(r=>r.members?.includes(remote)),false);
});
test('remote summary requires all four jobs even when an omitted shard plan is self consistent',()=>{
 const results={changes:'success',typecheck:'success',root:'success',packages:'success',receipts:'skipped'};
 function summarize(packages){const jobs=['changes','typecheck',...['1','2','3','4'].map(n=>`root (${n}/4)`),...packages.map(r=>`package (${r.package}, shard ${r.shard}/${r.shards})`)].map(name=>({name,status:'completed',conclusion:'success'}));
  return assertSummary({packages,receipts:[],typecheck:true},results,jobs);}
 assert.doesNotThrow(()=>summarize(rows));
 for(let i=0;i<4;i++)assert.throws(()=>summarize(rows.filter((_,n)=>n!==i)),/Incomplete package allocation/);
 assert.throws(()=>packageMembers({package:'@waitron-cloud/identity + '+remote,members:['@waitron-cloud/identity',remote],shard:1}),/Invalid package group members/);
});
test('remote shards discover every current file and a future file exactly once through Node',()=>{
 const workspace=loadWorkspace(),selected=workPlan({full:false,packages:[remote]},workspace).packages;
 assert.equal(selected.length,4);
 const files=readdirSync(new URL('../packages/remote-access/test/',import.meta.url)).filter(f=>f.endsWith('.test.ts')).concat('zz-future-remote.test.ts').sort();
 const root=mkdtempSync(join(tmpdir(),'cloud-remote-shards-'));
 try{
  for(const name of files)writeFileSync(join(root,name),`import test from 'node:test';test(${JSON.stringify(name)},()=>{});\n`);
  const seen=[],env={...process.env};delete env.NODE_TEST_CONTEXT;
  for(const row of selected){const output=execFileSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=30000',`--test-shard=${row.shard}/${row.shards}`,'*.test.ts'],{cwd:root,env,encoding:'utf8',timeout:30000});
   const names=[...output.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1]);assert.ok(names.length>0);assert.match(output,/^# fail 0$/m);assert.match(output,/^# cancelled 0$/m);assert.match(output,/^# skipped 0$/m);seen.push(...names);}
  assert.deepEqual(seen.sort(),files);
 }finally{rmSync(root,{recursive:true,force:true});}
});
