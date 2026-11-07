import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, realpathSync, lstatSync, unlinkSync} from 'node:fs';
import {join, resolve, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {LocalLeases} from './leases.mjs';
import {withKernelLock} from './kernel-lock.mjs';
import {runLocal} from './local.mjs';
import {SSHTransport, runProcess, protectOutputStreams} from './transport.mjs';

function refuseLegacy(state) {
  for (const name of ['manual.lock','recovery.lock','ledger/lock']) {
    try { lstatSync(join(state,name)); }
    catch (error) { if (error.code==='ENOENT') continue; throw error; }
    throw new Error('Legacy gate present; leave it untouched: '+name);
  }
}

function privateDirectory(path) {
  const info=lstatSync(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid===process.getuid() &&
    (info.mode&0o077)===0,'Temporary state must be a private owned directory');
}

async function withTemporaryState(state,work) {
  const temporary=join(state,'tmp'),ledger=join(state,'ledger');
  try { privateDirectory(temporary);rmSync(temporary,{recursive:true}); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  try {
    privateDirectory(ledger);
    for(const name of readdirSync(ledger)) if(/^state-[a-f0-9-]{36}\.tmp$/.test(name)) {
      const path=join(ledger,name),info=lstatSync(path);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid===process.getuid() &&
        (info.mode&0o077)===0,'Unowned ledger temporary');
      unlinkSync(path);
    }
  } catch(error) { if(error.code!=='ENOENT') throw error; }
  mkdirSync(temporary,{mode:0o700});
  const previous=process.env.TMPDIR;
  process.env.TMPDIR=temporary;
  try { return await work(); }
  finally {
    if(previous===undefined) delete process.env.TMPDIR; else process.env.TMPDIR=previous;
    rmSync(temporary,{recursive:true,force:true});
  }
}

async function recoverState({leases,transport,signal=AbortSignal.timeout(120000)}) {
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

export async function reconcileManual(args) {
  return withKernelLock(args.state,async()=>{
    refuseLegacy(args.state);
    return withTemporaryState(args.state,()=>recoverState(args));
  });
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
  assert.deepEqual(Object.keys(config).sort(),['host','hostGeneration','mode','recipe','repository','state','version']);
  assert.ok(config.version===2 && config.mode==='manual-one-slot','Only manual single-slot use is enabled');
  assert.ok(typeof config.state==='string' && isAbsolute(config.state),'State needs an absolute path');
  const cancellation=new AbortController();
  const cancel=()=>cancellation.abort();
  for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal,cancel);
  const deadline=Date.now()+7500;
  const budget=AbortSignal.timeout(7500);
  const admission=AbortSignal.any([cancellation.signal,budget]);
  let admitted=false;
  try {
    const result=await withKernelLock(config.state,async()=>{
      cancellation.signal.throwIfAborted();
      refuseLegacy(config.state);
      return withTemporaryState(config.state,async()=>{
      if (bootstrap) {
        new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots:1,bootstrap:true});
        return {code:0};
      }
      if (reconciling) {
        const leases=new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots:1});
        return recoverState({leases,transport:new SSHTransport({host:config.host,recipe:config.recipe}),
          signal:AbortSignal.any([cancellation.signal,AbortSignal.timeout(120000)])});
      }
      const commonRead=await runProcess('git',['-c','core.fsmonitor=false','-C',resolve(checkout),'rev-parse','--path-format=absolute','--git-common-dir'],{capture:true,signal:admission});
      assert.equal(commonRead.code,0,'Cloud checkout could not be inspected');
      assert.equal(realpathSync(commonRead.stdout.trim()),realpathSync(config.repository),'This manual helper accepts only the configured Cloud repository');
      const leases=new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots:1});
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
        const downloaded = await runProcess('python3', ['-I', '-B', new URL('./private-packages.py', import.meta.url).pathname, 'fetch', join(temporary, 'private')], {signal: cancellation.signal, capture: true});
        assert.equal(downloaded.code, 0, 'Reviewed private package preparation failed');
        transport.source = source;
        transport.privatePackage = join(temporary, 'private', 'ui-core-0.1.0.tgz');
        console.log(`Source ${snapshot}; command starts in a fresh VM, maximum 55 minutes.`);
        return await runLocal({leases, transport, signal: cancellation.signal,
          request: {lane, turn: 'manual-'+randomUUID(), snapshot, argv}});
      } finally { rmSync(temporary, {recursive: true, force: true}); }
      });
    },{bootstrap,deadline});
    console.log(JSON.stringify({code:result.code,reason:result.reason,cleanup:result.cleanup,
      resourceId:result.lease?.resourceId ?? result.resourceId,snapshot:result.lease?.snapshot,error:result.error}));
    return result.code;
  } catch(error) {
    if (cancellation.signal.aborted) return 143;
    if (budget.aborted && !admitted && !reconciling && !bootstrap) return 75;
    throw error;
  } finally {
    for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.off(signal,cancel);
  }
}

if (process.argv[1] && process.argv[1]!=='-' && import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode=await main(process.argv.slice(2)); }
  catch(error) { console.error(error.message);process.exitCode=125; }
}
