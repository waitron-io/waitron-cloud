import assert from 'node:assert/strict';
import {ciIdentity,ciRequest,runnerName,orphanRunner,ciInvocation} from './ci-identity.mjs';
import {createHash, randomUUID} from 'node:crypto';
import {constants, fstatSync, mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const maxDuration = 55 * 60 * 1000;
const word = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  if(config.mode==='manual-one-slot'){
    assert.equal(config.slots,undefined,'Single-slot configuration cannot change capacity');return 1;
  }
  assert.ok(config.mode==='manual-slots' && Number.isSafeInteger(config.slots) && config.slots>1 && config.slots<=16,'Invalid concurrent controller capacity');
  return config.slots;
}

// Multi-slot writers hold the short ledger lock only during durable updates.
// Only independently observed guest absence can free capacity.
export class LocalLeases {
  constructor(directory, {hostGeneration, slots, now = Date.now, bootstrap = false, slot}) {
    assert.ok(typeof hostGeneration === 'string' && word.test(hostGeneration) && Number.isSafeInteger(slots) && slots >= 1 && slots <= 16, 'Invalid host configuration');
    this.directory = resolve(directory);
    this.hostGeneration = hostGeneration;
    this.capacity = slots;
    assert.ok(slot===undefined || Number.isSafeInteger(slot) && slot>=0 && slot<slots,'Invalid selected slot');
    this.slot = slot;
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
    }
    assert.ok(state.version === 1 && state.hostGeneration === this.hostGeneration && state.slots.length === this.capacity, 'Ledger configuration changed; reconcile the previous host first');
    assert.ok(state.turns && typeof state.turns==='object' && !Array.isArray(state.turns) &&
      Object.getPrototypeOf(state.turns)===Object.prototype,'Invalid ledger turn history');
    assert.ok(state.slots.every((s, i) => s.id === i && Number.isSafeInteger(s.generation) && s.generation >= 0 &&
      ['free', 'reserved', 'running', 'quarantined'].includes(s.state) && (s.state === 'free' ? s.lease === null : s.lease?.generation === s.generation)), 'Invalid ledger slot');
    assert.ok(Object.entries(state.turns).every(([key,turn])=>/^[A-K]:[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(key) &&
      turn && typeof turn==='object' && !Array.isArray(turn) && typeof turn.fingerprint==='string' && /^[a-f0-9]{64}$/.test(turn.fingerprint) &&
      Number.isSafeInteger(turn.slot) && turn.slot>=0 && turn.slot<this.capacity &&
      Number.isSafeInteger(turn.generation) && turn.generation>=1 && turn.generation<=state.slots[turn.slot].generation),
      'Invalid retained turn history');
    for (const slot of state.slots.filter(s => s.state !== 'free')) {
      const lease = slot.lease;
      requestIdentity(lease);
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
        return {code: 75, reason: 'turn-finished-or-quarantined'};
      }
      if(identity.ci && (this.scope(state).orphanRunners?.length??0)>=32) return {code:75,reason:'orphan-runners-full'};
      const slot = state.slots.find(s => s.state === 'free' && (this.slot===undefined || s.id===this.slot));
      if (!slot) return {code: 75, reason: 'capacity-busy'};
      // Retaining completed turn IDs prevents a delayed request recreating work.
      assert.ok(Object.keys(state.turns).length < 10000, 'Local turn history full; archive only after reconciliation');
      assert.ok(slot.generation < Number.MAX_SAFE_INTEGER, 'Slot generation exhausted');
      slot.generation++;
      slot.state = 'reserved';
      slot.lease = {...identity, slot: slot.id, hostGeneration: this.hostGeneration, generation: slot.generation,
        resourceId: `dt-${this.hostGeneration}-${slot.id}-${slot.generation}`, createdAt: now, deadline: now + durationMs};
      state.turns[key] = {fingerprint, slot: slot.id, generation: slot.generation};
      return {code: 0, created: true, lease: slot.lease};
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
  inspect() { return this.transaction(state => {
    if(this.slot===undefined)return state;
    const scoped=this.scope(state);
    return {version:state.version,hostGeneration:state.hostGeneration,turns:state.turns,slots:[scoped],
      ...(scoped.ciInvocation===undefined?{}:{ciInvocation:scoped.ciInvocation}),
      ...(scoped.orphanRunners===undefined?{}:{orphanRunners:scoped.orphanRunners})};
  }); }
}
