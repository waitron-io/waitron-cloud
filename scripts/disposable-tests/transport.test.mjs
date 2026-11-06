import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

test('transport preserves literal arguments, stdin and exit3 without invoking a shell', async () => {
  const {runProcess} = await import('./transport.mjs');
  const result = await runProcess(process.execPath, ['-e', `let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{console.log(JSON.stringify([process.argv[1],s]));process.exit(3)})`, 'a; $(false) b'], {input: 'source data', capture: true});
  assert.equal(result.code, 3);
  assert.deepEqual(JSON.parse(result.stdout), ['a; $(false) b', 'source data']);
});

// Returning on abort before a child is dead lets cleanup race a still-running transfer.
test('transport cancellation waits for the owned process group to die', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'disposable-transport-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const {runProcess} = await import('./transport.mjs');
  const cancellation = new AbortController();
  const marker = join(directory, 'late');
  const result = runProcess(process.execPath, ['-e', `process.on('SIGTERM',()=>{});console.log('ready');setTimeout(()=>require('fs').writeFileSync(process.argv[1],'unexpected'),3000)`, marker], {
    signal: cancellation.signal, onOutput: () => cancellation.abort(),
  });
  await assert.rejects(result, /abort|cancel/i);
  await delay(1100);
  assert.throws(() => readFileSync(marker), /ENOENT/);
});

test('an already-cancelled transport never starts its subprocess', async () => {
  const {runProcess} = await import('./transport.mjs');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(0)'], {signal: AbortSignal.abort()}), /abort/i);
});

test('machine-readable transport output has a hard byte limit', async () => {
  const {runProcess} = await import('./transport.mjs');
  await assert.rejects(runProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(1000000))"], {capture: true}), /output.*limit/i);
});

// A multiplexed SSH master can retain pipe handles after the owned client exits.
// Cancellation must let the caller close remote work through another channel.
test('cancelled transport settles when an independent connection retains its output pipe', async t => {
  const {runProcess} = await import('./transport.mjs');
  const cancellation = new AbortController();
  let retained;
  const program = `const{spawn}=require('node:child_process');
const h=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});
console.log(h.pid);setInterval(()=>{},1000)`;
  try {
    const work = runProcess(process.execPath, ['-e', program], {signal: cancellation.signal, onOutput: data => {
      retained = Number(data.toString().trim());
      cancellation.abort();
    }});
    await assert.rejects(Promise.race([work, delay(3500).then(() => {throw new Error('Still waiting for the shared connection pipe');})]), /Transport aborted/);
  } finally {
    if (Number.isInteger(retained) && retained > 0) {
      try { process.kill(retained, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
});

test('cancellation after client exit closes pipes retained by a shared connection', async () => {
  const {runProcess} = await import('./transport.mjs');
  const cancellation = new AbortController();
  let retained, output = '';
  const program = `const{spawn}=require('node:child_process');
const h=spawn(process.execPath,['-e',"setTimeout(()=>console.log('AFTER-EXIT'),300);setInterval(()=>{},1000)"],{detached:true,stdio:['ignore',1,2]});
console.log(h.pid);process.exit(0)`;
  try {
    const work = runProcess(process.execPath, ['-e', program], {signal: cancellation.signal, onOutput: data => {
      output += data.toString();
      retained = Number(output.split('\n')[0]);
      if (output.includes('AFTER-EXIT')) cancellation.abort();
    }});
    await assert.rejects(Promise.race([work, delay(3500).then(() => {throw new Error('The exited client retained its shared pipe');})]), /Transport aborted/);
  } finally {
    if (Number.isInteger(retained) && retained > 0) {
      try { process.kill(retained, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
});
