import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,cpSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createPlan} from './ci-plan.mjs';
import {loadWorkspace} from './ci-scope.mjs';
import {assertSummary} from './ci-summary.mjs';

const repository='waitron-io/waitron-cloud';
test('real squash merges run full on main for equal trees and advanced main without API access',()=>{
  const root=mkdtempSync(join(tmpdir(),'cloud-ci-merge-'));
  try {
    const git=(...args)=>execFileSync('git',['-c','maintenance.auto=false',...args],{cwd:root,encoding:'utf8'}).trim();
    execFileSync('git',['clone','--shared','--quiet',process.cwd(),root],{stdio:'pipe'});
    cpSync('scripts',join(root,'scripts'),{recursive:true});
    git('checkout','-B','main'); git('config','user.name','CI test'); git('config','user.email','ci@example.test');
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
      assert.equal(git('rev-parse', `${sha}^{tree}`) === git('rev-parse', `${head}^{tree}`), !behind);
      let greenCalls = 0;
      const plan=createPlan({before:parent,commits:[{}]},{sha,repository,branch:'main'},workspace,git,path=>{greenCalls++;return api(path);});
      assert.equal(greenCalls, 0);
      const expectedPackages = [
        ...[['account-http',3],['backups',2],['portal',3],['registration',5]].flatMap(([name, shards]) =>
          Array.from({length: shards}, (_,i) => ({package:`@waitron-cloud/${name}`, shard:i+1, shards}))),
        ...['fiscal-allocation','translation','ui-smoke'].map(name=>({package:`@waitron-cloud/${name}`,shard:1})),
        {package:'@waitron-cloud/identity + @waitron-cloud/operations + @waitron-cloud/remote-access',
          members:['@waitron-cloud/identity','@waitron-cloud/operations','@waitron-cloud/remote-access'],shard:1},
      ];
      assert.deepEqual([...plan.packages].sort((a,b)=>a.package.localeCompare(b.package)||a.shard-b.shard),
        [...expectedPackages].sort((a,b)=>a.package.localeCompare(b.package)||a.shard-b.shard));
      const expectedJobs = ['changes','typecheck','root (1/4)','root (2/4)','root (3/4)','root (4/4)','receipts', ...expectedPackages.map(row=>`package (${row.package}${row.shards ? `, shard ${row.shard}/${row.shards}` : ''})`)];
      const jobs = expectedJobs.map(name=>({name,status:'completed',conclusion:'success'}));
      const results = {changes:'success',typecheck:'success',root:'success',receipts:'success',packages:'success',documentation:'skipped',scripts:'skipped'};
      assert.doesNotThrow(()=>assertSummary(plan,results,jobs));
      for (const name of expectedJobs.slice(1)) assert.throws(()=>assertSummary(plan,results,jobs.filter(job=>job.name!==name)));
      for (const group of ['root','typecheck','receipts','packages']) assert.throws(()=>assertSummary(plan,{...results,[group]:'skipped'},jobs));
      assert.equal(plan.typecheck,true);
      assert.deepEqual(plan.receipts,['test:two-venue-milestone-receipt','test:backup-capacity','test:public-gateway-limits','test:local-stack','test:database-recovery-receipt']);
      assert.equal(plan.reuse,null);
      const apiCalls = [];
      const unavailable = createPlan({before:parent,commits:[{}]}, {sha,repository,branch:'main'}, workspace, git,
        path => {apiCalls.push(path); throw Error('API unavailable');});
      assert.deepEqual(unavailable, plan);
      assert.deepEqual(apiCalls, []);
      const executable = join(root, 'gh');
      const marker = join(root, 'api-called');
      writeFileSync(executable, '#!/bin/sh\ntouch "$CI_API_MARKER"\nexit 1\n', {mode: 0o700});
      const eventPath = join(root, 'event.json'), outputPath = join(root, 'output');
      writeFileSync(eventPath, JSON.stringify({before:parent,commits:[{}]}));
      writeFileSync(outputPath, '');
      const env = {...process.env, PATH:`${root}:${process.env.PATH}`, CI_API_MARKER:marker,
        GITHUB_EVENT_PATH:eventPath, GITHUB_OUTPUT:outputPath, GITHUB_SHA:sha,
        GITHUB_REPOSITORY:repository, GITHUB_REF_NAME:'main'};
      const executed = spawnSync(process.execPath, ['scripts/ci-plan.mjs'], {cwd:root, env, encoding:'utf8', timeout:30_000});
      assert.equal(executed.status, 0, executed.stdout + executed.stderr);
      const outputs = Object.fromEntries(readFileSync(outputPath, 'utf8').trim().split('\n').map(line => [line.slice(0,line.indexOf('=')),line.slice(line.indexOf('=')+1)]));
      assert.deepEqual(JSON.parse(outputs.plan), plan);
      for (const key of ['typecheck','packages','receipts']) assert.equal(outputs[key],'true');
      for (const key of ['documentation','scripts']) assert.equal(outputs[key],'false');
      assert.deepEqual(JSON.parse(outputs.package_matrix),{include:plan.packages});
      assert.equal(existsSync(marker), false, 'Main planning never contacts the PR API');
      for (const path of ['gh','event.json','output']) rmSync(join(root,path));

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
    const results={changes:{result:'success'},typecheck:{result:'success'},root:{result:'success'},packages:{result:'success'},receipts:{result:'success'}};
    const jobs=['changes','typecheck','root (1/4)','root (2/4)','root (3/4)','root (4/4)','package (@waitron-cloud/operations)','receipts'].map(name=>({name,status:'completed',conclusion:'success'}));
    const env={...process.env,PATH:`${root}:${process.env.PATH}`,CI_FIXTURE:fixture,CI_PLAN:JSON.stringify(plan),CI_RESULTS:JSON.stringify(results),GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:'42'};
    const run=()=>spawnSync(process.execPath,['scripts/ci-summary.mjs'],{env,encoding:'utf8'});
    writeFileSync(fixture,JSON.stringify([{jobs}]));assert.equal(run().status,0);
    writeFileSync(fixture,JSON.stringify([{jobs:jobs.slice(0,-1)}]));const missing=run();assert.equal(missing.status,1);assert.match(missing.stderr,/Missing or duplicate job/);
    writeFileSync(fixture,JSON.stringify([{jobs}]));
    for (const group of ['changes','typecheck','root','packages','receipts']) {
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
