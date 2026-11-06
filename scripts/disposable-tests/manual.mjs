import assert from 'node:assert/strict';
import {mkdirSync, lstatSync, rmdirSync, mkdtempSync, rmSync, readFileSync, realpathSync, existsSync, writeFileSync, unlinkSync, openSync, fsyncSync, closeSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {LocalLeases} from './leases.mjs';
import {runLocal} from './local.mjs';
import {SSHTransport, runProcess, protectOutputStreams} from './transport.mjs';

function privateState(directory) {
  mkdirSync(directory, {recursive:true,mode:0o700});
  const info=lstatSync(directory);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o077)===0,'Manual state must be a private owned directory');
}
function readOwner(path) {
  const info=lstatSync(join(path,'owner.json'));
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&info.size<=1024&&(info.mode&0o077)===0,'Unknown manual gate owner');
  const owner=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'));
  assert.ok(owner.version===1&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.nonce==='string'&&/^[a-f0-9-]{36}$/.test(owner.nonce),'Unknown manual gate owner');
  return owner;
}
function claimGate(directory,name) {
  const path=join(directory,name);
  try {mkdirSync(path,{mode:0o700});}
  catch(error) {if(error.code==='EEXIST')return;throw error;}
  const owner={version:1,pid:process.pid,nonce:randomUUID()};
  const fd=openSync(join(path,'owner.json'),'wx',0o600);
  try {writeFileSync(fd,JSON.stringify(owner));fsyncSync(fd);} finally {closeSync(fd);}
  const parent=openSync(path,'r');try {fsyncSync(parent);} finally {closeSync(parent);}
  return {path,owner};
}
function releaseGate(gate) {
  assert.deepEqual(readOwner(gate.path),gate.owner,'Another process owns this manual gate');
  unlinkSync(join(gate.path,'owner.json'));rmdirSync(gate.path);
}
function ownerDead(owner) {
  try {process.kill(owner.pid,0);return false;}
  catch(error) {return error.code==='ESRCH';}
}

// The gate covers packaging as well as work. A dead owner retains its record;
// only exact-lease recovery may remove it, never an age-based successor.
export async function withManualSlot(directory,work) {
  privateState(directory);
  if(existsSync(join(directory,'recovery.lock')))return {code:75,reason:'manual-recovery-owned'};
  const gate=claimGate(directory,'manual.lock');
  if(!gate)return {code:75,reason:'manual-slot-busy-or-needs-recovery'};
  try {
    if(existsSync(join(directory,'recovery.lock')))return {code:75,reason:'manual-recovery-owned'};
    return await work();
  } finally {releaseGate(gate);}
}

export async function recoverManual({state,leases,transport,resourceId,signal=AbortSignal.timeout(120000)}) {
  privateState(state);
  const recovery=claimGate(state,'recovery.lock');
  if(!recovery)return {code:75,reason:'recovery-already-owned-or-needs-inspection'};
  let gate;
  try {
    const path=join(state,'manual.lock');
    if(existsSync(path)) {
      let owner;
      try {owner=readOwner(path);} catch {return {code:75,reason:'manual-owner-unknown'};}
      if(!ownerDead(owner))return {code:75,reason:'manual-owner-still-live-or-unknown'};
      gate={path,owner};
    } else {
      gate=claimGate(state,'manual.lock');
      if(!gate)return {code:75,reason:'manual-owner-raced-recovery'};
    }
    const ledger=leases.inspect();
    assert.ok(Array.isArray(ledger.slots),'Ledger is locked or unknown; inspect its owner before recovery');
    const lease=ledger.slots.find(slot=>slot.lease?.resourceId===resourceId)?.lease;
    assert.ok(lease,'No matching recorded lease; recovery refused');
    try {
      await transport.destroy(lease,{signal});
      const observed=await transport.inspect(lease,{signal});
      assert.ok(observed.resourceId===resourceId&&observed.absent===true,'Exact resource absence was not proved');
      assert.equal(leases.release(lease,observed),true,'Recorded lease release refused');
    } catch(error) {leases.release(lease,undefined);throw error;}
    releaseGate(gate);
    return {code:0,cleanup:'absent',resourceId};
  } finally {releaseGate(recovery);}
}

export async function main(args) {
  protectOutputStreams();
  const recovering=args.length===3&&args[1]==='--recover';
  assert.ok(recovering||(args.length>=5&&args[3]==='--'),'Usage: manual.mjs CONFIG LANE CLOUD_CHECKOUT -- COMMAND [ARGS] | CONFIG --recover RESOURCE');
  const [configuration, lane, checkout, , ...argv] = args;
  if(!recovering)assert.match(lane, /^[A-K]$/, 'Invalid campaign lane');
  if(!recovering)assert.ok(argv.length>0&&argv[0]&&argv.every(v=>!v.includes('\0')),'A literal command argument list is required');
  const config = JSON.parse(readFileSync(configuration, 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['host', 'hostGeneration', 'mode', 'recipe', 'repository', 'state', 'version']);
  assert.ok(config.version === 2 && config.mode === 'manual-one-slot', 'Only manual single-slot use is enabled');
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  process.on('SIGHUP', cancel);
  try {
    console.log(`Disposable tests: ${config.mode}, generation ${config.hostGeneration}`);
    if(recovering) {
      const recovered=await recoverManual({state:resolve(config.state),leases:new LocalLeases(join(config.state,'ledger'),{hostGeneration:config.hostGeneration,slots:1}),transport:new SSHTransport({host:config.host,recipe:config.recipe}),resourceId:checkout,signal:AbortSignal.any([cancellation.signal,AbortSignal.timeout(120000)])});
      console.log(JSON.stringify(recovered));return recovered.code;
    }
    const commonRead=await runProcess('git',['-c','core.fsmonitor=false','-C',resolve(checkout),'rev-parse','--path-format=absolute','--git-common-dir'],{capture:true,signal:AbortSignal.any([cancellation.signal,AbortSignal.timeout(5000)])});
    assert.equal(commonRead.code,0,'Cloud checkout could not be inspected');
    assert.equal(realpathSync(commonRead.stdout.trim()),realpathSync(config.repository),'This manual helper accepts only the configured Cloud repository');
    const result = await withManualSlot(resolve(config.state), async () => {
      const leases = new LocalLeases(join(config.state, 'ledger'), {hostGeneration: config.hostGeneration, slots: 1});
      const state = leases.inspect();
      if (!state.slots || state.slots.some(slot => slot.state !== 'free')) return {code: 75, reason: 'recorded-slot-busy-or-quarantined'};
      const transport = new SSHTransport({host: config.host, recipe: config.recipe});
      let healthy;
      try { healthy = await transport.healthy({signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(8000)])}); }
      catch { healthy = false; }
      if (!healthy) return {code: cancellation.signal.aborted ? 143 : 75, reason: 'host-unavailable'};
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
    console.log(JSON.stringify({code: result.code, reason: result.reason, cleanup: result.cleanup,
      resourceId: result.lease?.resourceId, snapshot: result.lease?.snapshot, error: result.error}));
    return result.code;
  } catch (error) {
    if (!cancellation.signal.aborted) throw error;
    console.log(JSON.stringify({code:143,reason:'cancelled'}));
    return 143;
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
    process.off('SIGHUP', cancel);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 125; }
}
