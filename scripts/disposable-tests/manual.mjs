import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, chmodSync, rmSync, readFileSync, readdirSync, realpathSync, lstatSync, unlinkSync} from 'node:fs';
import {join, resolve, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {LocalLeases,configuredSlots,refuseLegacy,withAvailableSlot} from './leases.mjs';
export {refuseLegacy,withAvailableSlot} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {runLocal} from './local.mjs';
import {SSHTransport, runProcess, protectOutputStreams} from './transport.mjs';


function privateDirectory(path) {
  const info=lstatSync(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid===process.getuid() &&
    (info.mode&0o077)===0,'Temporary state must be a private owned directory');
}

export async function withTemporaryState(state,work) {
  const temporary=join(state,'tmp'),ledger=join(state,'ledger');
  try { privateDirectory(temporary); }
  catch(error) { if(error.code!=='ENOENT') throw error;mkdirSync(temporary,{mode:0o700}); }
  // Only this private owned container has its owner access restored. Orphan
  // children may retain files, but their housekeeping cannot stop guest recovery.
  chmodSync(temporary,0o700);
  let hasLedger=true;
  try { privateDirectory(ledger); }
  catch(error) { if(error.code!=='ENOENT') throw error;hasLedger=false; }
  const sweep=()=>{
    let incomplete=false;
    try {
      for(const name of readdirSync(temporary)) {
        try { rmSync(join(temporary,name),{recursive:true,force:true}); }
        catch { incomplete=true; }
      }
      if(hasLedger) {
        privateDirectory(ledger);
        for(const name of readdirSync(ledger)) if(/^state-[a-f0-9-]{36}\.tmp$/.test(name)) {
          try {
            const path=join(ledger,name),info=lstatSync(path);
            assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid===process.getuid() &&
              (info.mode&0o077)===0,'Unowned ledger temporary');
            unlinkSync(path);
          } catch { incomplete=true; }
        }
      }
    } catch { incomplete=true; }
    if(incomplete) console.error('Temporary cleanup incomplete; private files retained');
  };
  sweep();
  const previous=process.env.TMPDIR;
  process.env.TMPDIR=temporary;
  try { return await work(); }
  finally {
    if(previous===undefined) delete process.env.TMPDIR; else process.env.TMPDIR=previous;
    sweep();
  }
}


export async function recoverState({leases,transport,signal=AbortSignal.timeout(120000)}) {
  const occupied=leases.inspect().slots.filter(slot=>slot.state!=='free');
  assert.ok(occupied.length<=1,'Automatic recovery supports one slot');
  const lease=occupied[0]?.lease;
  if (!lease) return {code:0,cleanup:'absent'};
  try {
    await transport.destroy(lease,{signal});
    const observed=await transport.inspect(lease,{signal});
    assert.ok(observed.resourceId===lease.resourceId && observed.absent===true,'Exact resource absence was not proved');
    assert.equal(leases.release(lease,observed),true,'Recorded lease release refused');
  } catch(error) { leases.release(lease,undefined); throw error; }
  return {code:0,cleanup:'absent',resourceId:lease.resourceId};
}

export async function reconcileManual({state,hostGeneration,slots=1,slot,transport,signal,deadline,ci,cloudCi,api}) {
  protectOutputStreams();
  if(slots>1 && slot===undefined){
    let busy=0,pending=0;
    for(let selected=0;selected<slots;selected++){
      let result;
      try{result=await reconcileManual({state,hostGeneration,slots,slot:selected,transport,signal,deadline,ci,cloudCi,api});}
      catch(error){signal?.throwIfAborted();pending++;console.error(JSON.stringify({event:'slot-recovery-pending',slot:selected,error:error.message}));continue;}
      if(result.code===75){if(result.reason==='controller-busy')busy++;else pending++;continue;}
      assert.equal(result.code,0,'Slot recovery failed');
    }
    return {code:0,cleanup:pending?'pending':busy?'live-owners-preserved':'absent',busy,pending};
  }
  const ownedState=slot===undefined?state:join(state,'slot-'+slot);
  return withKernelLock(ownedState,async()=>{
    refuseLegacy(state);
    return withTemporaryState(ownedState,async()=>{
      const leases=new LocalLeases(join(state,'ledger'),{hostGeneration,slots,slot});
      const recorded=leases.inspect().slots.find(slot=>slot.state!=='free')?.lease;
      const cleanup=AbortSignal.timeout(120000);
      const result=await recoverState({leases,transport,signal:signal?AbortSignal.any([signal,cleanup]):cleanup});
      const current=leases.inspect();
      if(current.ciInvocation || current.orphanRunners?.length || recorded?.ci){
        const {GithubApp}=await import('./github-app.mjs');
        const {cleanupRunners,recoverCanary,qualifyCanary,cancelCIJob,fallbackOrdinary,setRoutingMode}=await import('./ci-canary.mjs');
        const policies=[ci,cloudCi].filter(Boolean),clients=new Map();
        const policyFor=id=>{const found=policies.filter(policy=>policy.repositoryId===id);assert.equal(found.length,1,'Recorded repository needs one configured policy');return found[0];};
        const ids=new Set([current.ciInvocation?.repositoryId,recorded?.ci?.repositoryId,...(current.orphanRunners??[]).map(orphan=>orphan.ci.repositoryId)].filter(id=>id!==undefined));
        for(const id of ids)policyFor(id);
        const client=policy=>{if(!clients.has(policy.repositoryId))clients.set(policy.repositoryId,policy===ci && api?api:new GithubApp(policy));return clients.get(policy.repositoryId);};
        if(cloudCi && current.ciInvocation?.repositoryId===cloudCi.repositoryId)
          await setRoutingMode({api:client(cloudCi),policy:cloudCi,mode:'hosted',signal:cleanup});
        const reconcileCI=async()=>{
        for(const id of ids){const policy=policyFor(id);await cleanupRunners({leases,api:client(policy),repository:policy.repository,repositoryId:id,signal:cleanup});}
        const pending=leases.inspect().ciInvocation;
        if(!pending)return result;
        const policy=policyFor(pending.repositoryId),selectedApi=client(policy);
        if(policy===cloudCi){
          const {drainCloud}=await import('./cloud.mjs');
          const outcome=await drainCloud({api:selectedApi,policy,leases,signal:cleanup});
          return outcome.code===75?{...outcome,reason:'ci-recovery-pending'}:result;
        }
        if(policy.workflowPath==='.github/workflows/ci.yml'){
          assert.ok(pending.runId!==null,'Recorded ordinary CI run is missing');
          const identity={repositoryId:policy.repositoryId,workflowId:policy.workflowId,workflowSha:pending.workflowSha,
            runId:pending.runId,attempt:pending.attempt,jobId:pending.jobId};
          if(pending.ordinaryStage!==undefined){
            const outcome=await fallbackOrdinary({api:selectedApi,policy,ci:identity,leases,automatic:slots>1,signal:cleanup});
            if(outcome.pending)return {code:75,reason:'ci-recovery-pending'};
          }
          else await cancelCIJob({api:selectedApi,repository:policy.repository,ci:identity,signal:cleanup});
          leases.clearInvocation(pending.nonce);return result;
        }
        const invocation=await recoverCanary({api:selectedApi,leases,policy,signal:cleanup});
        if(invocation){
          const run=await selectedApi.get(`/repos/${policy.repository}/actions/runs/${invocation.runId}`,{signal:cleanup});
          if(run.status==='completed'){
            await qualifyCanary({api:selectedApi,policy,invocation,signal:cleanup});
            leases.clearInvocation(invocation.nonce);
          }
        }
        return result;
        };
        if(slots===1)return reconcileCI();
        const outcome=await withKernelLock(state,reconcileCI,{signal:cleanup});
        return outcome.code===75?{...outcome,reason:'ci-recovery-busy'}:outcome;
      }
      return result;
    });
  },{deadline,signal});
}

export async function main(args) {
  protectOutputStreams();
  const bootstrap=args.length===2 && args[1]==='--bootstrap';
  const reconciling=args.length===2 && args[1]==='--once';
  assert.ok(bootstrap || reconciling || (args.length>=5 && args[3]==='--'),
    'Usage: manual.mjs CONFIG LANE CLOUD_CHECKOUT -- COMMAND [ARGS] | CONFIG --once | CONFIG --bootstrap');
  const [configuration,lane,checkout,,...argv]=args;
  if (!bootstrap && !reconciling) {
    assert.match(lane,/^[A-K]$/,'Invalid campaign lane');
    assert.ok(argv.length>0 && argv[0] && argv.every(v=>!v.includes('\0')),'A literal command argument list is required');
  }
  const config=JSON.parse(readFileSync(configuration,'utf8'));
  if(config.ci!==undefined){const {validateCIConfig}=await import('./ci-canary.mjs');validateCIConfig(config);}
  else assert.deepEqual(Object.keys(config).sort(),['host','hostGeneration','mode','recipe','repository',...(config.mode==='manual-slots'?['slots']:[]),'state','version']);
  const slots=configuredSlots(config);
  assert.ok(typeof config.state==='string' && isAbsolute(config.state),'State needs an absolute path');
  const cancellation=new AbortController();
  const cancel=()=>cancellation.abort();
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,cancel);
  const deadline=Date.now()+7500;
  const budget=AbortSignal.timeout(7500);
  const admission=AbortSignal.any([cancellation.signal,budget]);
  let admitted=false;
  const withController=work=>!bootstrap && slots>1
    ?withAvailableSlot({...config,slots},context=>withTemporaryState(context.temporaryState,()=>work(context.leases)),{signal:cancellation.signal})
    :withKernelLock(config.state,()=>{refuseLegacy(config.state);return withTemporaryState(config.state,()=>work());},{bootstrap,deadline,signal:cancellation.signal});
  let lastRecovery=-Infinity;
  const recover=async()=>{
    if(Date.now()-lastRecovery<30000)return;
    lastRecovery=Date.now();
    return reconcileManual({state:config.state,hostGeneration:config.hostGeneration,slots,
      transport:new SSHTransport({host:config.host,recipe:config.recipe}),signal:cancellation.signal,deadline:Date.now()+7500,ci:config.ci,cloudCi:config.cloudCi});
  };
  try {
    const result=reconciling
      ? await recover()
      : await withController(async selected=>{
      cancellation.signal.throwIfAborted();
      refuseLegacy(config.state);
      if (bootstrap) {
        new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots,bootstrap:true});
        if(slots>1)for(let slot=0;slot<slots;slot++)await withKernelLock(join(config.state,'slot-'+slot),async()=>({code:0}),{bootstrap:true,signal:cancellation.signal});
        return {code:0};
      }
      const commonRead=await runProcess('git',['-c','core.fsmonitor=false','-C',resolve(checkout),'rev-parse','--path-format=absolute','--git-common-dir'],{capture:true,signal:admission});
      assert.equal(commonRead.code,0,'Cloud checkout could not be inspected');
      assert.equal(realpathSync(commonRead.stdout.trim()),realpathSync(config.repository),'This manual helper accepts only the configured Cloud repository');
      const leases=selected??new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots});
      const state=leases.inspect();
      if (state.slots.some(slot=>slot.state!=='free')) return {code:75,reason:'recorded-slot-busy-or-quarantined'};
      const transport=new SSHTransport({host:config.host,recipe:config.recipe});
      let healthy;
      try { healthy=await transport.healthy({signal:admission}); } catch { healthy=false; }
      if (!healthy) return {code:cancellation.signal.aborted?143:75,reason:'host-unavailable'};
      admitted=true;
      console.log(`Disposable tests: ${config.mode}, generation ${config.hostGeneration}`);
      const temporary = mkdtempSync(join(tmpdir(), 'disposable-manual-'));
      try {
        const source = join(temporary, 'source.tar');
        const copied = await runProcess('python3', ['-I', '-B', new URL('./snapshot.py', import.meta.url).pathname, 'create', resolve(checkout), source], {signal: cancellation.signal, capture: true});
        assert.equal(copied.code, 0, 'Source snapshot failed');
        const snapshot = JSON.parse(copied.stdout).sha256;
        const selected=await runProcess('python3',['-I','-B',new URL('./private-packages.py',import.meta.url).pathname,'select',source],{signal:cancellation.signal,capture:true});
        assert.equal(selected.code,0,'Captured source needs one reviewed private release');
        const privateFile=selected.stdout.trim();assert.match(privateFile,/^ui-core-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/,'Invalid selected private filename');
        const downloaded = await runProcess('python3', ['-I', '-B', new URL('./private-packages.py', import.meta.url).pathname, 'fetch', join(temporary, 'private')], {signal: cancellation.signal, capture: true});
        assert.equal(downloaded.code, 0, 'Reviewed private package preparation failed');
        transport.source = source;
        transport.privatePackage = join(temporary, 'private', privateFile);
        console.log(`Source ${snapshot}; command starts in a fresh VM, maximum 55 minutes.`);
        return await runLocal({leases, transport, signal: cancellation.signal,
          request: {lane, turn: 'manual-'+randomUUID(), snapshot, argv}});
      } finally { rmSync(temporary, {recursive: true, force: true}); }
    });
    if(!reconciling || result.code!==0 || result.resourceId || result.pending)
      console.log(JSON.stringify({code:result.code,reason:result.reason,cleanup:result.cleanup,
        resourceId:result.lease?.resourceId ?? result.resourceId,snapshot:result.lease?.snapshot,error:result.error,
        ...(result.pending?{pending:result.pending,busy:result.busy}:{})}));
    if(reconciling && result.code===0 && slots>1 && config.ci?.workflowPath==='.github/workflows/ci.yml'){
      const {automaticTick}=await import('./control.mjs'),{GithubApp}=await import('./github-app.mjs');
      await automaticTick({configuration,config,api:new GithubApp(config.ci),signal:cancellation.signal,recover});
    }
    return result.code;
  } catch(error) {
    const refusal=cancellation.signal.aborted?{code:143,reason:'cancelled'}:
      budget.aborted && !admitted && !reconciling && !bootstrap?{code:75,reason:'admission-budget'}:undefined;
    if(refusal){console.log(JSON.stringify(refusal));return refusal.code;}
    throw error;
  } finally {
    for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.off(signal,cancel);
  }
}

if (process.argv[1] && process.argv[1]!=='-' && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode=await main(process.argv.slice(2)); }
  catch(error) { console.error(error.message);process.exitCode=125; }
}
