import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';

const repository='waitron-io/waitron-cloud';
test('real squash merges reuse equal trees and run full when main has advanced',()=>{
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-merge-'));
  try {
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
    git('init','-b','main'); git('config','user.name','CI test'); git('config','user.email','ci@example.test');
    writeFileSync(join(root,'baseline'),'baseline');git('add','.');git('commit','-sm','Baseline');
    const before=git('rev-parse','HEAD');
    git('checkout','-b','feature');writeFileSync(join(root,'portal'),'portal');git('add','.');git('commit','-sm','Portal change');
    const head=git('rev-parse','HEAD');git('checkout','main');
    const workspace=loadWorkspace();
    for (const behind of [false,true]) {
      git('reset','--hard',before);
      if (behind) {writeFileSync(join(root,'other'),'main change');git('add','.');git('commit','-sm','Advance main');}
      const parent=git('rev-parse','HEAD');git('merge','--squash','feature');git('commit','-sm','Merge feature');
      const sha=git('rev-parse','HEAD');
      const api=path=>path.includes('/commits/') ? [{state:'closed',merged_at:'2026-10-14T09:00:00Z',merge_commit_sha:sha,base:{ref:'main',repo:{full_name:repository}},head:{sha:head,ref:'feature',repo:{full_name:repository}}}] : path.includes('/jobs?') ? {total_count:2,jobs:['changes','summary'].map(name=>({name,status:'completed',conclusion:'success'}))} : {workflow_runs:[{id:42,head_sha:head,head_branch:'feature',head_repository:{full_name:repository},event:'pull_request',path:'.github/workflows/ci.yml',status:'completed',conclusion:'success'}]};
      const plan=createPlan({before:parent,commits:[{}]},{sha,repository,branch:'main'},workspace,git,api);
      assert.equal(plan.packages.length,behind?20:0);
      if (behind) assert.match(plan.reason,/Merge tree differs/);
      assert.deepEqual(plan.reuse,behind?null:{sha:head,runId:42});
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('executed summary consumes needs objects and the current job API, refusing omissions and lookup failures',()=>{
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-summary-'));
  try {
    const fixture=join(root,'jobs.json');
    const gh=join(root,'gh');
    writeFileSync(gh,'#!/bin/sh\n[ "$1" = api ] || exit 2\ncat "$CI_FIXTURE"\n',{mode:0o700});
    const plan={packages:[{package:'@waitron-cloud/operations',shard:1}],receipts:['test:local-stack'],typecheck:true,reuse:null};
    const results={changes:{result:'success'},typecheck:{result:'success'},packages:{result:'success'},receipts:{result:'success'}};
    const jobs=['changes','typecheck','package (@waitron-cloud/operations)','receipts'].map(name=>({name,status:'completed',conclusion:'success'}));
    const env={...process.env,PATH:`${root}:${process.env.PATH}`,CI_FIXTURE:fixture,CI_PLAN:JSON.stringify(plan),CI_RESULTS:JSON.stringify(results),GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:'42'};
    const run=()=>spawnSync(process.execPath,['scripts/ci-summary.mjs'],{env,encoding:'utf8'});
    writeFileSync(fixture,JSON.stringify([{jobs}]));assert.equal(run().status,0);
    writeFileSync(fixture,JSON.stringify([{jobs:jobs.slice(0,-1)}]));const missing=run();assert.equal(missing.status,1);assert.match(missing.stderr,/Missing or duplicate job/);
    writeFileSync(fixture,JSON.stringify([{jobs}]));
    for (const group of ['changes','typecheck','packages','receipts']) {
      for (const result of ['failure','cancelled','skipped','','queued','in_progress']) {
        env.CI_RESULTS=JSON.stringify({...results,[group]:{result}});
        assert.equal(run().status,1,`${group}=${result} must refuse success`);
      }
    }
    env.CI_RESULTS=JSON.stringify(results);
    const documentation={base:'a'.repeat(40),head:'b'.repeat(40),paths:['docs/backlog.md']};
    env.CI_PLAN=JSON.stringify({packages:[],receipts:[],typecheck:false,reuse:null,documentation});
    env.CI_RESULTS=JSON.stringify({changes:{result:'success'},documentation:{result:'success'},typecheck:{result:'skipped'},packages:{result:'skipped'},receipts:{result:'skipped'}});
    writeFileSync(fixture,JSON.stringify([{jobs:['changes','documentation'].map(name=>({name,status:'completed',conclusion:'success'}))}]));
    const documentResult=run();assert.equal(documentResult.status,0);assert.match(documentResult.stdout,/Passed 1 document check/);
    writeFileSync(gh,'#!/bin/sh\nexit 1\n',{mode:0o700});assert.equal(run().status,1);
  } finally {rmSync(root,{recursive:true,force:true});}
});
