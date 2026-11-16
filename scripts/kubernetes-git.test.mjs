import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const command = promisify(execFile);
const api = await import('./kubernetes-git.mjs').catch(error => {if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; return {};});

// A mutable registry reference or another node would defeat the offline C-loss check.
test('rendered controllers use owned offline tags and stay on A', () => {
  const source = ['source-controller', 'kustomize-controller'].map(name => ({apiVersion:'apps/v1',kind:'Deployment',metadata:{name},
    spec:{replicas:2,template:{spec:{containers:[{name:'manager',image:'upstream:mutable'}]}}}}));
  const rendered = api.renderFluxControllers(source.map(JSON.stringify).join('\n'), 'd618-test', 'd618-test-control-plane');
  assert.deepEqual(rendered.items.map(row => row.spec.replicas), [1,1]);
  for (const row of rendered.items) {
    assert.deepEqual(row.spec.template.spec.nodeSelector, {'kubernetes.io/hostname':'d618-test-control-plane'});
    assert.equal(row.spec.template.spec.containers[0].image, 'd618-test:' + row.metadata.name);
    assert.equal(row.spec.template.spec.containers[0].imagePullPolicy, 'Never');
  }
  assert.equal(api.fluxImages('d618-test')[0].upstream, 'ghcr.io/fluxcd/source-controller@sha256:4d77b2cfa9b0baadfa2b99b11a52ef41f43f968286e37bb7e5b4886b3227438a');
});

// Corrupt downloaded tools must not execute before stack creation.
test('preparation refuses a changed Flux archive before running a tool', async t => {
  const directory = await mkdtemp(join(tmpdir(),'flux-archive-test-')); t.after(() => rm(directory,{recursive:true,force:true}));
  let executed = false;
  await assert.rejects(api.prepareFluxBundle(directory,'d618-test', {fetch:async () => new Response('changed release'),
    run:async () => {executed=true;}}), /flux.archive_digest/);
  assert.equal(executed,false);
});

// These commands exercise stock Git HTTP, including fetch's POST, rather than a fake response.
test('private mirror serves a signed-off revision but refuses network pushes', async t => {
  const directory=await mkdtemp(join(tmpdir(),'flux-mirror-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await command('git',['init','--bare',join(directory,'run.git')]);
  const work=join(directory,'work');await mkdir(work);
  const git = args => command('git',['-C',work,'-c','user.name=Cloud rehearsal','-c','user.email=rehearsal@example.test',...args]);
  await git(['init']);await writeFile(join(work,'deployment.yaml'),'kind: Deployment\n');await git(['add','.']);await git(['commit','-s','-m','Synthetic deployment']);
  await git(['push',join(directory,'run.git'),'HEAD:main']);
  const expected=(await git(['rev-parse','HEAD'])).stdout.trim();
  const server=await api.serveMirror({repository:directory,host:'127.0.0.1',port:0});
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const url='http://127.0.0.1:'+server.address().port+'/run.git';
  assert.equal((await fetch(url+'/HEAD')).status,403);
  const clone=join(directory,'clone');await command('git',['clone','--branch','main',url,clone]);
  assert.equal((await command('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),expected);
  assert.match((await command('git',['-C',clone,'show','-s','--format=%B'])).stdout,/Signed-off-by: Cloud rehearsal <rehearsal@example.test>/);
  await assert.rejects(git(['push',url,'HEAD:refs/heads/forbidden']),/403|forbidden/i);
  assert.equal((await command('git',['--git-dir='+join(directory,'run.git'),'for-each-ref','--format=%(refname)'])).stdout.trim(),'refs/heads/main');
});

const revision='1'.repeat(40), oldRevision='2'.repeat(40), annotation='waitron.io/p1-revision';
function observed(sha=revision,value='candidate') {
  return {
    gitrepository:{status:{artifact:{revision:'main@sha1:'+sha}}},
    kustomization:{metadata:{generation:1},status:{observedGeneration:1,lastAppliedRevision:'main@sha1:'+sha,lastAttemptedRevision:'main@sha1:'+sha,conditions:[{type:'Ready',status:'True',reason:'ReconciliationSucceeded'}]}},
    deployment:{metadata:{generation:3},spec:{template:{metadata:{annotations:{[annotation]:value}}}},status:{observedGeneration:3}},
    pods:{items:[{metadata:{uid:'replacement',annotations:{[annotation]:value}},spec:{nodeName:'box-worker'},status:{conditions:[{type:'Ready',status:'True'}]}}]},
  };
}
// A Ready condition alone must not qualify an old revision, an old pod or a late response.
for(const mismatch of ['source','applied','pod','late','controller','deployment-generation','root-generation']) test('revision observation refuses '+mismatch+' evidence',async()=>{
  let clock=0;const values=observed();
  if(mismatch==='source')values.gitrepository.status.artifact.revision='main@sha1:'+oldRevision;
  if(mismatch==='pod')values.pods.items[0].metadata.annotations[annotation]='old';
  if(mismatch==='applied')values.kustomization.status.lastAppliedRevision='main@sha1:'+oldRevision;
  if(mismatch==='deployment-generation')values.deployment.status.observedGeneration=2;
  if(mismatch==='root-generation')values.kustomization.status.observedGeneration=0;
  await assert.rejects(api.waitFluxRevision({sha:revision,value:'candidate',worker:'box-worker',...(mismatch==='controller'?{sourceUid:'replacement'}:{}),deadline:3000,now:()=>clock,
    sleep:async ms=>{clock+=ms;},kube:async args=>{if(mismatch==='late')clock+=1000;return JSON.stringify(values[args[1]]);}}),/flux.revision_timeout/);
});

test('a rejected render counts only with its attempted SHA and the unchanged healthy workload',async()=>{
  for(const healthy of [true,false]){
    let clock=0;const values=observed(oldRevision,'refetched');values.gitrepository.status.artifact.revision='main@sha1:'+revision;
    values.kustomization.status.lastAttemptedRevision='main@sha1:'+revision;
    values.kustomization.status.conditions=[{type:'Ready',status:'False',reason:'BuildFailed'}];
    values.pods.items[0].status.conditions[0].status=healthy?'True':'False';
    const run=api.waitFluxRevision({sha:revision,applied:oldRevision,rejected:true,value:'refetched',worker:'box-worker',deadline:3000,now:()=>clock,
      sleep:async ms=>{clock+=ms;},kube:async args=>JSON.stringify(values[args[1]])});
    if(healthy)assert.equal((await run).reason,'BuildFailed');else await assert.rejects(run,/flux.revision_timeout/);
  }
});

test('mirror cleanup removes only its created container, including failed initialization',async()=>{
  for(const fail of [false,true]){
    const calls=[],id='a'.repeat(64);let submitted;
    const start=api.startFluxMirror({name:'d618-test',image:'sha256:'+'b'.repeat(64),run:async(binary,args,input)=>{
      calls.push(args);if(args[0]==='run')return id;if(args[0]==='port')return '10.77.0.1:53123';
      if(args[0]==='exec'){if(fail)throw Error('initialization failed');if(input){submitted=input;return revision;}}return '';
    }});
    if(fail)await assert.rejects(start,/initialization failed/);
    else{const mirror=await start;assert.equal(mirror.url,'http://10.77.0.1:53123/run.git');assert.equal(await mirror.publish('synthetic deployment'),'1'.repeat(40));assert.equal(submitted,'synthetic deployment');await mirror.close();}
    assert.deepEqual(calls.at(-1),['rm','-f',id]);
    assert.ok(calls[0].includes('10.77.0.1::8000'));
  }
});

test('bootstrap puts the Deployment only in Git and leaves replica scaling outside its inventory',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'flux-bootstrap-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'flux.json');await writeFile(path,JSON.stringify({apiVersion:'v1',kind:'List',items:[]}));
  const workload=JSON.parse(await readFile(new URL('../deploy/kubernetes/local-checks.yaml',import.meta.url),'utf8')).items.find(row=>row.kind==='Deployment');
  const applied=[],applyArgs=[];let published,closed=0;
  const values=observed(revision,'baseline');values.pods.items[0].spec.nodeName='box-worker2';
  const result=await api.installFlux({name:'box',image:'waitron:test',deployment:workload,controllersPath:path,
    mirror:async()=>({url:'http://10.77.0.1:53123/run.git',publish:async text=>{published=JSON.parse(text);return revision;},close:async()=>{closed++;}}),
    kube:async(args,input)=>{if(args[0]==='apply'){applied.push(JSON.parse(input));applyArgs.push(args);}return args[0]==='get'?JSON.stringify(values[args[1]]):'';}});
  assert.equal(applyArgs[0][applyArgs[0].indexOf('-n')+1],'flux-system','controller apply must override the wrapper’s default namespace');
  assert.equal(published.metadata.namespace,'default');
  assert.equal(published.spec.replicas,undefined);assert.equal(workload.spec.replicas,1);
  assert.deepEqual(published.spec.strategy,{type:'RollingUpdate',rollingUpdate:{maxUnavailable:0,maxSurge:1}});
  assert.equal(published.spec.template.metadata.annotations[annotation],'baseline');
  assert.equal(applied.flatMap(row=>row.items).some(row=>row.kind==='Deployment'),false);
  assert.equal(applied.at(-1).items.find(row=>row.kind==='GitRepository').spec.url,'http://10.77.0.1:53123/run.git');
  await result.close();assert.equal(closed,1);
  await assert.rejects(api.installFlux({name:'box',image:'waitron:test',deployment:workload,controllersPath:path,
    mirror:async()=>({publish:async()=>revision,close:async()=>{closed++;}}),kube:async()=>{throw Error('apply refused');}}),/apply refused/);
  assert.equal(closed,2);
});

test('repair measures command time, drift, cache refetch and rejected-render retention before restoring Git',async()=>{
  let clock=0,count=0,values=observed('0'.repeat(40),'baseline'),uid='old-controller',repairAt=Infinity,desired='baseline';
  values.pods.items[0].spec.nodeName='box-worker';
  const publishes=[];
  const publish=async text=>{
    clock+=2000;const sha=String(++count).repeat(40);publishes.push(text);
    if(text.startsWith('{')){desired=JSON.parse(text).spec.template.metadata.annotations[annotation];values=observed(sha,desired);}
    else{values.gitrepository.status.artifact.revision='main@sha1:'+sha;values.kustomization.status.lastAttemptedRevision='main@sha1:'+sha;values.kustomization.status.conditions=[{type:'Ready',status:'False',reason:'BuildFailed'}];}
    return sha;
  };
  const kube=async(args,input)=>{
    if(args[0]==='patch'){
      clock+=1000;assert.equal(JSON.parse(args[args.indexOf('-p')+1]).spec.template.metadata.annotations[annotation],'drift');
      values.deployment.spec.template.metadata.annotations[annotation]='drift';repairAt=clock+1000;return '';
    }
    if(args[0]==='delete'){clock+=3000;uid='new-controller';return '';}
    if(args[0]==='get'&&args.includes('app=source-controller'))return JSON.stringify({items:[{metadata:{uid,name:uid},status:{conditions:[{type:'Ready',status:'True'}]}}]});
    if(clock>=repairAt)values.deployment.spec.template.metadata.annotations[annotation]=desired;
    return JSON.stringify(values[args[1]]);
  };
  const deployment={spec:{template:{metadata:{annotations:{[annotation]:'baseline'}}}}};
  const result=await api.reconcileFlux({publish,kube,deployment,worker:'box-worker',now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.deepEqual(result,{revisionMs:2000,driftMs:2000,refetchMs:5000,refusalMs:2000,restoreMs:2000,
    appliedRevision:'4'.repeat(40),attemptedRevision:'3'.repeat(40)});
  assert.equal(publishes.length,4);assert.equal(JSON.parse(publishes.at(-1)).spec.template.metadata.annotations[annotation],'refetched');
});

// A missing workload must not hide the source/controller evidence that explains its absence.
test('timeout diagnostics keep partial revisions and controller apply/fetch refusal',async t=>{
  const events=[];t.mock.method(process.stderr,'write',value=>{events.push(String(value));return true;});
  for(const [reason,missing] of [['ReconciliationFailed',true],['ReconciliationFailed',false],['ArtifactFailed',false]]){
    let clock=0;const values=observed(oldRevision,'candidate');values.gitrepository.status.artifact.revision='main@sha1:'+revision;
    values.kustomization.status.lastAttemptedRevision='main@sha1:'+revision;
    values.kustomization.status.conditions=[{type:'Ready',status:'False',reason}];
    await assert.rejects(api.waitFluxRevision({sha:revision,value:'candidate',worker:'box-worker',deadline:3000,now:()=>clock,sleep:async ms=>{clock+=ms;},
      kube:async args=>{if(missing&&args[1]==='deployment')throw Error('missing workload');return JSON.stringify(values[args[1]]);}}),/flux.revision_timeout/);
    const last=JSON.parse(events.at(-1).slice('Flux revision observation '.length));
    assert.equal(last.source,revision);assert.equal(last.applied,oldRevision);assert.equal(last.attempted,revision);assert.equal(last.reason,reason);
    if(missing)assert.deepEqual(last.unavailable,['deployment']);
  }
});
