import assert from 'node:assert/strict';
import {ciIdentity,ciRequest,runnerName,orphanRunner,ciInvocation} from './ci-identity.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {constants, fstatSync, mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {withKernelLock} from './kernel-lock.mjs';

const maxDuration = 55 * 60 * 1000;
const word = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const familyGuestMiB={
 'bundle-smoke':9216,'changes':6144,'lint':10240,'mutation-shared':9216,'mutation-shared-aggregate':4096,
 'root-guards':10240,'test-adjustments':10240,'test-bookings':10240,'test-fiscal-verifactu':11264,
 'test-heavy':9216,'test-identity':8192,'test-light-a':9216,'test-light-b':9216,'test-media':11264,
 'test-payments-stripe':10240,'test-payments-sumup':10240,'test-provisioning':10240,'test-server':14336,
 'test-server-stream':10240,'test-staffing':13312,'test-venue-service':12288,'test-workforce':8192
};
export const ciGuestMemoryMiB=ci=>ci?.workflowPath==='.github/workflows/ci.yml' && ci.event==='pull_request'
 ?familyGuestMiB[ci.jobKey.replace(/-[0-9]+$/,'')]??16384:16384;
const validGuestMiB=value=>Number.isSafeInteger(value)&&value>=4096&&value<=16384&&value%1024===0;
function validateMemory(memory,slots){
 const {slotHosts,hostMiB}=memory;
 assert.ok(Array.isArray(slotHosts)&&slotHosts.length===slots&&hostMiB&&
  new Set(slotHosts).size===Object.keys(hostMiB).length&&slotHosts.every(host=>typeof host==='string'&&
   /^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host)&&Number.isSafeInteger(hostMiB[host])&&hostMiB[host]>=34816),'Invalid host memory budget');
}
export function configuredMemory(config){
 if(config.hostMemoryMiB===undefined)return;
 assert.ok(config.mode==='manual-slots','Memory budgets require the multi-slot controller');
 const memory={slotHosts:config.slotHosts,hostMiB:config.hostMemoryMiB};validateMemory(memory,config.slots);return memory;
}
const reservedMiB=slot=>slot.lease?(slot.lease.guestMemoryMiB??16384)+2048:
 slot.ciInvocation?(slot.ciInvocation.guestMemoryMiB??16384)+2048:0;
export function memoryFits(state,slot,guestMiB,pending=[]){
 if(!state.memory)return true;
 const host=state.memory.slotHosts[slot];
 const used=state.slots.reduce((sum,s)=>sum+(s.id!==slot && state.memory.slotHosts[s.id]===host?reservedMiB(s):0),0)+
  pending.reduce((sum,p)=>sum+(state.memory.slotHosts[p.slot]===host?p.guestMemoryMiB+2048:0),0);
 return used+guestMiB+2048+16384<=state.memory.hostMiB[host];
}
export function memoryCapacity(state,healthy=true,pending=[]){
 const usable=healthy?state.slots.filter(s=>(!Array.isArray(healthy)||healthy.includes(s.id))&&s.state!=='quarantined'&&!s.orphanRunners?.length):[];
 const busy=usable.filter(s=>s.state!=='free'||s.ciInvocation).length+pending.length;
 if(!state.memory)return {slots:usable.length,busy};
 let free=0;
 for(const host of new Set(state.memory.slotHosts)){
  const onHost=s=>state.memory.slotHosts[s.id]===host;
  const waiting=pending.filter(p=>state.memory.slotHosts[p.slot]===host);
  const identifiers=usable.filter(s=>onHost(s)&&s.state==='free'&&!s.ciInvocation&&!waiting.some(p=>p.slot===s.id)).length;
  const used=state.slots.filter(onHost).reduce((sum,s)=>sum+reservedMiB(s),0)+waiting.reduce((sum,p)=>sum+p.guestMemoryMiB+2048,0);
  free+=Math.min(identifiers,Math.floor(Math.max(0,state.memory.hostMiB[host]-16384-used)/18432));
 }
 return {slots:busy+free,busy};
}
export const ciRetryReady=(turn,state,jobId,now=Date.now())=>!turn.busyRunnerRetried && !turn.admissionQuotaRetried && !turn.registration5xxRetried &&
  (turn.busyRunnerRefusedAt!==undefined && now-turn.busyRunnerRefusedAt>=60000 ||
   turn.admissionQuotaRetryAt!==undefined && now>=turn.admissionQuotaRetryAt ||
   turn.registration5xxFailedAt!==undefined && now-turn.registration5xxFailedAt>=60000) &&
  ![state,...state.slots].some(s=>s.orphanRunners?.some(r=>r.ci.jobId===jobId));
function requestIdentity(request) {
  assert.ok(request && typeof request.lane === 'string' && /^[A-K]$/.test(request.lane) &&
    typeof request.turn === 'string' && word.test(request.turn) &&
    typeof request.snapshot === 'string' && /^[a-f0-9]{64}$/.test(request.snapshot) && Array.isArray(request.argv) &&
    request.argv.length > 0 && request.argv.length <= 256 &&
    request.argv.every(v => typeof v === 'string' && v.length <= 16384 && !v.includes('\0')) &&
    request.argv[0].length > 0, 'Invalid local request');
  const identity={lane: request.lane, turn: request.turn, snapshot: request.snapshot, argv: [...request.argv]};
  if (request.ci!==undefined) {
    const ci=ciIdentity(request.ci),canonical=ciRequest(request.lane,ci);
    assert.deepEqual(identity,{lane:canonical.lane,turn:canonical.turn,snapshot:canonical.snapshot,argv:canonical.argv},'CI request identity differs');
    identity.ci=ci;
  }
  return identity;
}

export function configuredSlots(config) {
  assert.equal(config.version,2,'Invalid controller configuration version');
  configuredMemory(config);
  if(config.mode==='manual-one-slot'){
    assert.ok(config.slots===undefined && config.slotHosts===undefined,'Single-slot configuration cannot change capacity');return 1;
  }
  assert.ok(config.mode==='manual-slots' && Number.isSafeInteger(config.slots) && config.slots>1 && config.slots<=16,'Invalid concurrent controller capacity');
  if(config.slotHosts!==undefined)assert.ok(Array.isArray(config.slotHosts) && config.slotHosts.length===config.slots &&
    config.slotHosts.every(host=>typeof host==='string' && /^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(host)),'Invalid slot host mapping');
  return config.slots;
}

// Multi-slot writers hold the short ledger lock only during durable updates.
// Only independently observed guest absence can free capacity.
export class LocalLeases {
  constructor(directory, {hostGeneration, slots, now = Date.now, bootstrap = false, slot, memory}) {
    assert.ok(typeof hostGeneration === 'string' && word.test(hostGeneration) && Number.isSafeInteger(slots) && slots >= 1 && slots <= 16, 'Invalid host configuration');
    this.directory = resolve(directory);
    this.hostGeneration = hostGeneration;
    this.capacity = slots;
    assert.ok(slot===undefined || Number.isSafeInteger(slot) && slot>=0 && slot<slots,'Invalid selected slot');
    this.slot = slot;
    this.memory = memory;
    this.now = now;
    if (bootstrap) mkdirSync(this.directory, {mode: 0o700});
    const info = lstatSync(this.directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid() &&
      (info.mode & 0o077) === 0, 'Ledger must be a private owned directory');
    if(bootstrap && slots>1) closeSync(openSync(join(this.directory,'mac-controller.lock'),'wx',0o600));
    if (bootstrap) this.transaction(state => state, true);
  }
  transaction(operation, initialize = false) {
    if(this.capacity===1)return this.update(operation,initialize);
    let fd;
    try {fd=openSync(join(this.directory,'mac-controller.lock'),constants.O_RDWR|constants.O_NOFOLLOW);}
    catch(error){if(error.code==='ENOENT')throw new Error('Ledger configuration lacks its multi-slot lock; reconcile the previous host first',{cause:error});throw error;}
    try {
      const info=fstatSync(fd);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid===process.getuid() && (info.mode&0o077)===0,'Unsafe ledger lock');
      const lock=spawnSync('/usr/bin/python3',['-I','-B','-c','import fcntl; fcntl.flock(3,fcntl.LOCK_EX)'],
        {stdio:['ignore','ignore','pipe',fd],timeout:7500});
      assert.equal(lock.status,0,'Ledger lock did not settle');
      return this.update(operation,initialize);
    } finally { closeSync(fd); }
  }
  scope(state) { return this.slot===undefined?state:state.slots[this.slot]; }
  update(operation, initialize = false) {
    const path = join(this.directory, 'state.json');
    let state;
    try {
      const info=lstatSync(path);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid===process.getuid() &&
        (info.mode&0o077)===0,'Ledger state must be a private owned regular file');
      state = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      assert.ok(initialize, 'Recorded ledger is missing; initialization requires explicit bootstrap');
      state = {version: 1, hostGeneration: this.hostGeneration, slots: Array.from({length: this.capacity}, (_, id) => ({id, generation: 0, state: 'free', lease: null})), turns: {}};
      if(this.memory!==undefined)state.memory=structuredClone(this.memory);
    }
    assert.ok(state.version === 1 && state.hostGeneration === this.hostGeneration && state.slots.length === this.capacity, 'Ledger configuration changed; reconcile the previous host first');
    if(this.memory!==undefined)assert.deepEqual(state.memory,this.memory,'Memory configuration changed; reconcile the previous host first');
    if(state.memory!==undefined)validateMemory(state.memory,this.capacity);
    assert.ok(state.quotaHoldUntil===undefined || Number.isSafeInteger(state.quotaHoldUntil) && state.quotaHoldUntil>=0,'Invalid quota hold');
    assert.ok(state.ignoredEmptyRuns===undefined || Array.isArray(state.ignoredEmptyRuns) &&
      state.ignoredEmptyRuns.every(key=>typeof key==='string' && /^[1-9][0-9]*:[1-9][0-9]*$/.test(key)),'Invalid ignored empty runs');
    assert.ok(state.turns && typeof state.turns==='object' && !Array.isArray(state.turns) &&
      Object.getPrototypeOf(state.turns)===Object.prototype,'Invalid ledger turn history');
    assert.ok(state.slots.every((s, i) => s.id === i && Number.isSafeInteger(s.generation) && s.generation >= 0 &&
      ['free', 'reserved', 'running', 'quarantined'].includes(s.state) && (s.state === 'free' ? s.lease === null : s.lease?.generation === s.generation)), 'Invalid ledger slot');
    assert.ok(Object.entries(state.turns).every(([key,turn])=>/^[A-K]:[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(key) &&
      turn && typeof turn==='object' && !Array.isArray(turn) && typeof turn.fingerprint==='string' && /^[a-f0-9]{64}$/.test(turn.fingerprint) &&
      Number.isSafeInteger(turn.slot) && turn.slot>=0 && turn.slot<this.capacity &&
      (turn.busyRunnerRefusedAt===undefined || Number.isSafeInteger(turn.busyRunnerRefusedAt) && turn.busyRunnerRefusedAt>=0) &&
      (turn.busyRunnerRetried===undefined || turn.busyRunnerRetried===true && turn.busyRunnerRefusedAt!==undefined) &&
      (turn.admissionQuotaRetryAt===undefined || Number.isSafeInteger(turn.admissionQuotaRetryAt) && turn.admissionQuotaRetryAt>=0) &&
      (turn.admissionQuotaRetried===undefined || turn.admissionQuotaRetried===true && turn.admissionQuotaRetryAt!==undefined) &&
      (turn.registration5xxFailedAt===undefined || Number.isSafeInteger(turn.registration5xxFailedAt) && turn.registration5xxFailedAt>=0) &&
      (turn.registration5xxRetried===undefined || turn.registration5xxRetried===true && turn.registration5xxFailedAt!==undefined) &&
      Number.isSafeInteger(turn.generation) && turn.generation>=1 && turn.generation<=state.slots[turn.slot].generation),
      'Invalid retained turn history');
    for (const slot of state.slots.filter(s => s.state !== 'free')) {
      const lease = slot.lease;
      requestIdentity(lease);
      assert.ok(lease.guestMemoryMiB===undefined||validGuestMiB(lease.guestMemoryMiB),'Invalid leased guest memory');
      if(lease.runnerId!==undefined) assert.ok(lease.ci && Number.isSafeInteger(lease.runnerId) && lease.runnerId>0,'Invalid bound CI runner');
      assert.ok(lease.hostGeneration === this.hostGeneration && lease.slot === slot.id &&
        lease.resourceId === `dt-${this.hostGeneration}-${slot.id}-${slot.generation}` &&
        Number.isSafeInteger(lease.createdAt) && lease.createdAt >= 0 &&
        Number.isSafeInteger(lease.deadline) && lease.deadline > lease.createdAt &&
        lease.deadline - lease.createdAt <= maxDuration, 'Invalid occupied lease');
    }
    assert.ok(this.capacity===1 || state.ciInvocation===undefined && !(state.orphanRunners?.length),'Shared CI metadata in a multi-slot ledger requires reconciliation');
    for(const record of [state,...state.slots]) {
    if(record.ciInvocation!==undefined) ciInvocation(record.ciInvocation);
    if(record.orphanRunners!==undefined) {
      assert.ok(Array.isArray(record.orphanRunners) && record.orphanRunners.length<=32,'Invalid orphan runner list');
      record.orphanRunners.forEach(orphanRunner);
      assert.equal(new Set(record.orphanRunners.map(r=>r.runnerName)).size,record.orphanRunners.length,'Duplicate orphan runner');
    }
    }
    if(this.capacity>1)for(const name of readdirSync(this.directory))if(/^state-[a-f0-9-]{36}\.tmp$/.test(name)){
      try{
        const path=join(this.directory,name),info=lstatSync(path);
        assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid===process.getuid() && (info.mode&0o077)===0,'Unowned ledger temporary');
        unlinkSync(path);
      }catch(error){if(error.code!=='ENOENT')console.error('Interrupted ledger temporary retained');}
    }
    const before=initialize?undefined:JSON.stringify(state);
    const now = this.now();
    assert.ok(Number.isSafeInteger(now) && now >= 0, 'Invalid controller time');
    for (const slot of state.slots) if (slot.state !== 'free' && slot.lease.deadline <= now) slot.state = 'quarantined';
    const result = operation(state, now);
    const serialized=JSON.stringify(state);
    if(before===serialized) return structuredClone(result);
    const temporary = join(this.directory, `state-${randomUUID()}.tmp`);
    let fd;
    try {
      fd = openSync(temporary, 'wx', 0o600);
      writeFileSync(fd, serialized + '\n');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      renameSync(temporary, path);
      const directoryFd = openSync(this.directory, 'r');
      try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return structuredClone(result);
  }

  reserveLocal(request, {healthy = true, durationMs = maxDuration} = {}) {
    const identity = requestIdentity(request);
    if(identity.ci)assert.ok(this.capacity===1 || this.slot!==undefined,'Concurrent CI requires a scoped slot');
    assert.ok(typeof healthy === 'boolean', 'Invalid host health');
    assert.ok(Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= maxDuration, 'Invalid lease duration');
    if (!healthy) return {code: 75, reason: 'host-down'};
    return this.transaction((state, now) => {
      if(identity.ci && state.turns[`${identity.lane}:ci-${identity.ci.runId}-${identity.ci.attempt}`])return {code:75,reason:'legacy-ci-attempt-recorded'};
      const key = `${identity.lane}:${identity.turn}`, fingerprint = digest(identity);
      const prior = state.turns[key];
      if (prior) {
        assert.equal(prior.fingerprint, fingerprint, 'Turn reused with different request');
        const slot = state.slots[prior.slot];
        if ((this.slot===undefined || this.slot===prior.slot) && slot.generation === prior.generation && ['reserved', 'running'].includes(slot.state)) return {code: 0, created: false, lease: slot.lease};
        if(!identity.ci || !ciRetryReady(prior,state,identity.ci.jobId,now))
          return {code: 75, reason: 'turn-finished-or-quarantined'};
      }
      if(identity.ci && (this.scope(state).orphanRunners?.length??0)>=32) return {code:75,reason:'orphan-runners-full'};
      const slot = state.slots.find(s => s.state === 'free' && (this.slot===undefined || s.id===this.slot));
      if (!slot) return {code: 75, reason: 'capacity-busy'};
      const guestMemoryMiB=ciGuestMemoryMiB(identity.ci);
      if(!memoryFits(state,slot.id,guestMemoryMiB))return {code:75,reason:'memory-capacity-busy'};
      assert.ok(prior || Object.keys(state.turns).length < 10000, 'Local turn history full; archive only after reconciliation');
      assert.ok(slot.generation < Number.MAX_SAFE_INTEGER, 'Slot generation exhausted');
      slot.generation++;
      slot.state = 'reserved';
      slot.lease = {...identity, slot: slot.id, hostGeneration: this.hostGeneration, generation: slot.generation,
        resourceId: `dt-${this.hostGeneration}-${slot.id}-${slot.generation}`, createdAt: now, deadline: now + durationMs};
      if(state.memory)slot.lease.guestMemoryMiB=guestMemoryMiB;
      state.turns[key] = {...prior,fingerprint, slot: slot.id, generation: slot.generation,...(prior?(prior.admissionQuotaRetryAt!==undefined?{admissionQuotaRetried:true}:prior.registration5xxFailedAt!==undefined?{registration5xxRetried:true}:{busyRunnerRetried:true}):{})};
      return {code: 0, created: true, lease: slot.lease};
    });
  }
  recordBusyRunnerFailure(result) {
    return this.recordCIRetryFailure(result);
  }
  recordCIRetryFailure(result,reason) {
    const lease=result?.lease,quota=Number.isSafeInteger(reason) && reason>=0,registration=reason==='registration-5xx';
    if(result?.code!==125 || result.cleanup!=='absent' || !(quota || registration || /^CI runner assignment is busy elsewhere(?:\n|$)/.test(result.error??'')) ||
      lease?.ci?.workflowPath!=='.github/workflows/ci.yml')return false;
    let identity;try{identity=requestIdentity(lease);}catch{return false;}
    return this.transaction((state,now)=>{
      const turn=state.turns[`${lease.lane}:${lease.turn}`];
      if(!turn || turn.fingerprint!==digest(identity) || turn.slot!==lease.slot || turn.generation!==lease.generation ||
        lease.hostGeneration!==this.hostGeneration || lease.resourceId!==`dt-${this.hostGeneration}-${turn.slot}-${turn.generation}` ||
        state.slots.some(slot=>slot.lease?.resourceId===lease.resourceId) || turn.busyRunnerRefusedAt!==undefined || turn.admissionQuotaRetryAt!==undefined || turn.registration5xxFailedAt!==undefined)return false;
      if(quota)turn.admissionQuotaRetryAt=reason;else if(registration)turn.registration5xxFailedAt=now;else turn.busyRunnerRefusedAt=now;return true;
    });
  }
  owns(slot, lease) {
    return (this.slot===undefined || slot?.id===this.slot) && slot?.state !== 'free' && slot?.lease && digest(slot.lease) === digest(lease);
  }
  start(lease) {
    return this.transaction(state => {
      const slot = state.slots[lease?.slot];
      if (!this.owns(slot, lease) || slot.state !== 'reserved') return false;
      slot.state = 'running';
      return true;
    });
  }
  release(lease, observation) {
    if(lease?.ci)assert.ok(this.capacity===1 || this.slot!==undefined,'Concurrent CI cleanup requires a scoped slot');
    return this.transaction(state => {
      const slot = state.slots[lease?.slot];
      if (!this.owns(slot, lease)) return false;
      if (observation?.absent !== true || observation.resourceId !== lease.resourceId) {
        slot.state = 'quarantined';
        return false;
      }
      if(lease.ci) {
        const orphan={ci:lease.ci,runnerName:runnerName(lease.ci),runnerId:lease.runnerId??null};
        const record=this.scope(state);
        record.orphanRunners??=[];
        assert.ok(record.orphanRunners.length<32,'Orphan runner list full');
        record.orphanRunners.push(orphan);
      }
      slot.state = 'free'; slot.lease = null;
      return true;
    });
  }
  bindRunner(lease,runnerId) {
    assert.ok(lease.ci && Number.isSafeInteger(runnerId) && runnerId>0,'Invalid CI runner binding');
    const result=this.transaction(state=>{
      const slot=state.slots[lease.slot];
      if(!this.owns(slot,lease))return false;
      assert.ok(slot.lease.runnerId===undefined || slot.lease.runnerId===runnerId,'CI runner already bound');
      slot.lease.runnerId=runnerId;return slot.lease;
    });
    if(result)Object.assign(lease,result);
    return Boolean(result);
  }
  setInvocation(value) {
    assert.ok(this.capacity===1 || this.slot!==undefined,'Concurrent CI intent requires a scoped slot');
    ciInvocation(value);
    return this.transaction(state=>{
      if(!memoryFits(state,this.slot??0,value.guestMemoryMiB??16384))return false;
      if(this.capacity>1 && value.jobId!==undefined)assert.ok(!state.slots.some(slot=>slot.id!==this.slot &&
        slot.ciInvocation?.runId===value.runId && slot.ciInvocation.attempt===value.attempt && slot.ciInvocation.jobId===value.jobId),
        'CI job is already recorded on another slot');
      this.scope(state).ciInvocation=value;return value;
    });
  }
  clearInvocation(nonce) {
    return this.transaction(state=>{const record=this.scope(state);if(record.ciInvocation?.nonce!==nonce)return false;delete record.ciInvocation;return true;});
  }
  forgetRunner(orphan) {
    orphanRunner(orphan);
    return this.transaction(state=>{
      const record=this.scope(state);
      const index=(record.orphanRunners??[]).findIndex(value=>digest(value)===digest(orphan));
      if(index<0) return false;
      record.orphanRunners.splice(index,1);return true;
    });
  }
  holdQuota(until) {
    assert.ok(Number.isSafeInteger(until) && until>=0,'Invalid quota hold');
    if(this.capacity===1)return;
    return this.transaction(state=>{state.quotaHoldUntil=Math.max(state.quotaHoldUntil??0,until);});
  }
  ignoreEmptyRun(key) {
    assert.match(key,/^[1-9][0-9]*:[1-9][0-9]*$/);
    return this.transaction(state=>{
      state.ignoredEmptyRuns??=[];
      if(state.ignoredEmptyRuns.includes(key))return false;
      state.ignoredEmptyRuns.push(key);return true;
    });
  }
  inspect() { return this.transaction(state => {
    if(this.slot===undefined)return state;
    const scoped=this.scope(state);
    return {version:state.version,hostGeneration:state.hostGeneration,turns:state.turns,slots:[scoped],
      ...(state.memory===undefined?{}:{memory:state.memory}),
      ...(scoped.ciInvocation===undefined?{}:{ciInvocation:scoped.ciInvocation}),
      ...(scoped.orphanRunners===undefined?{}:{orphanRunners:scoped.orphanRunners})};
  }); }
}

export function refuseLegacy(state) {
  for (const name of ['manual.lock','recovery.lock','ledger/lock']) {
    try { lstatSync(join(state,name)); }
    catch (error) { if (error.code==='ENOENT') continue; throw error; }
    throw new Error('Legacy gate present; leave it untouched: '+name);
  }
}

// The slot lock lives through cleanup; the shared ledger lock covers only updates.
export async function withAvailableSlot({state,hostGeneration,slots,host,slotHosts},work,{signal,healthySlots,ci,preferredSlot}={}) {
  assert.ok(Number.isSafeInteger(slots) && slots>1 && slots<=16,'Invalid concurrent slot budget');
  assert.ok(healthySlots===undefined || Array.isArray(healthySlots) && healthySlots.every(slot=>Number.isSafeInteger(slot) && slot>=0 && slot<slots),'Invalid healthy slot inventory');
  refuseLegacy(state);
  assert.ok(preferredSlot===undefined || Number.isSafeInteger(preferredSlot)&&preferredSlot>=0&&preferredSlot<slots,'Invalid planned slot');
  const refusedHosts=new Set(),order=Array.from({length:slots},(_,slot)=>slot);
  if(preferredSlot!==undefined)order.unshift(...order.splice(preferredSlot,1));
  for(const slot of order){
    const target=slotHosts?.[slot]??host??slot;
    if(refusedHosts.has(target))continue;
    if(healthySlots!==undefined && !healthySlots.includes(slot))continue;
    let admitted=false,tryAnother=false;
    const result=await withKernelLock(join(state,'slot-'+slot),async()=>{
      const leases=new LocalLeases(join(state,'ledger'),{hostGeneration,slots,slot});
      const current=leases.inspect();
      if(current.ciInvocation || current.slots[0].state!=='free')return {code:75,reason:'recorded-slot-busy-or-quarantined'};
      const whole=new LocalLeases(join(state,'ledger'),{hostGeneration,slots}).inspect();
      if(!memoryFits(whole,slot,ciGuestMemoryMiB(ci)))return {code:75,reason:'memory-capacity-busy'};
      admitted=true;
      const result=await work({leases,slot,temporaryState:join(state,'slot-'+slot)});
      if(result.code===75&&['host-unavailable','host-down','memory-capacity-busy'].includes(result.reason)){
        const after=leases.inspect();tryAnother=!after.ciInvocation&&after.slots[0].state==='free';
      }
      return result;
    },{signal});
    if(tryAnother)refusedHosts.add(target);
    else if(admitted || result.code!==75)return result;
  }
  return {code:75,reason:'capacity-busy'};
}
