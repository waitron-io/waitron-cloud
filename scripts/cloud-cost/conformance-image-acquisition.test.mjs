import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const transient='Error response from daemon: Head "https://registry-1.docker.io/v2/library/node/manifests/26.11.1-slim": Get "https://auth.docker.io/token?account=githubactions&scope=repository%3Alibrary%2Fnode%3Apull&service=registry.docker.io": net/http: request canceled (Client.Timeout exceeded while awaiting headers)';

// The real preparer supervises real children; only the external Docker boundary is replaced.
async function prepare(t,scenario={}) {
  const root=await mkdtemp(join(tmpdir(),'cost-image-acquisition-')),bin=join(root,'bin'),state=join(root,'state.json');
  await mkdir(bin);
  await writeFile(state,JSON.stringify({calls:[],failures:[],...scenario}));
  await writeFile(join(bin,'docker'),`#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';
const path=${JSON.stringify(state)},data=JSON.parse(readFileSync(path)),args=process.argv.slice(2);
data.calls.push(args);writeFileSync(path,JSON.stringify(data));
const fail=message=>{console.error(message);process.exit(1);};
if(args[0]==='image'&&args[1]==='inspect') {
  if(data.inspectFailure)fail(data.inspectFailure);
  if(!data.cached)fail('Error: No such image: '+args[2]);
} else if(args[0]==='pull') {
  if(data.hang){data.pid=process.pid;writeFileSync(path,JSON.stringify(data));setInterval(()=>{},1000);}
  else {
  if(data.failures.length){const message=data.failures.shift();writeFileSync(path,JSON.stringify(data));fail(message);}
  }
} else fail('Unexpected Docker operation: '+args.join(' '));
`,{mode:0o700});
  const driver=join(root,'driver.mjs');
  await writeFile(driver,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const original=fs.mkdtempSync;fs.mkdtempSync=(...args)=>{const path=original(...args);fs.writeFileSync(${JSON.stringify(join(root,'scratch'))},path);return path;};syncBuiltinESMExports();
${scenario.interrupt?`const timers=await import('node:timers/promises');const timer=timers.default.setTimeout;timers.default.setTimeout=(ms,...args)=>timer(ms===1000?30000:ms,...args);syncBuiltinESMExports();`:''}
${scenario.shortTimeout?"const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms>290000?1500:ms,...args);":''}
${scenario.expiredBudget?`const now=performance.now.bind(performance);Object.defineProperty(performance,'now',{value:()=>now()+(JSON.parse(fs.readFileSync(${JSON.stringify(state)})).calls.some(args=>args[0]==='pull')?301000:0)});`:''}
${scenario.expireDuringBackoff?`const now=performance.now.bind(performance);let firstPull;Object.defineProperty(performance,'now',{value:()=>{const elapsed=now();if(JSON.parse(fs.readFileSync(${JSON.stringify(state)})).calls.some(args=>args[0]==='pull'))firstPull??=elapsed;return elapsed+(firstPull!==undefined&&elapsed-firstPull>500?301000:0);}});`:''}
const {prepareConformance}=await import(${JSON.stringify(new URL('./conformance-prepare.mjs',import.meta.url).href)});
const fixture=await prepareConformance(['foreground-conformance.test.mjs']);
try {console.log('PREPARED');} finally {fixture.cleanup();}
`);
  const child=spawn(process.execPath,[driver],{env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{
    const data=JSON.parse(await readFile(state,'utf8'));
    if(data.pid){try{process.kill(data.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));}
    await rm(root,{recursive:true,force:true});
  });
  let output='',interrupted=false;for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{
    output+=bytes;
    if(scenario.interrupt&&!interrupted&&output.includes('retrying')){interrupted=true;child.kill(scenario.interrupt);}
  });
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  const scratch=await readFile(join(root,'scratch'),'utf8');
  assert.equal(existsSync(scratch),false,'preparation collects its owned scratch on every outcome');
  return {...result,output,...JSON.parse(await readFile(state,'utf8'))};
}

// Removing the retry must prevent successful preparation after the exact CI registry failure.
test('image acquisition recovers from the observed Docker Hub token header timeout',{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[transient]});
  assert.equal(result.code,0,result.output);
  assert.match(result.output,/PREPARED/);
  assert.deepEqual(result.calls,[['image','inspect','node:26.11.1-slim'],['pull','node:26.11.1-slim'],['pull','node:26.11.1-slim']]);
  assert.match(result.output,/retry/i);
});

test('cached image prepares without any registry request',async t=>{
  const result=await prepare(t,{cached:true});
  assert.equal(result.code,0,result.output);
  assert.deepEqual(result.calls,[['image','inspect','node:26.11.1-slim']]);
});

for(const refusal of ['denied: requested access to the resource is denied',
  'invalid reference format',
  'unauthorized: authentication required; Client.Timeout',
  'manifest unknown: manifest unknown; unexpected EOF',
  'toomanyrequests: rate limit exceeded; i/o timeout']) {
  test('terminal registry refusal stops after one pull: '+refusal,{timeout:10000},async t=>{
    const result=await prepare(t,{failures:[refusal]});
    assert.equal(result.code,1,result.output);
    assert.deepEqual(result.calls,[['image','inspect','node:26.11.1-slim'],['pull','node:26.11.1-slim']]);
    assert.equal(result.output.includes('PREPARED'),false);
    assert.equal(result.output.includes('retrying'),false);
  });
}

test('unavailable Docker during inspection refuses without trying a pull',async t=>{
  const result=await prepare(t,{inspectFailure:'Cannot connect to the Docker daemon'});
  assert.equal(result.code,1,result.output);
  assert.deepEqual(result.calls,[['image','inspect','node:26.11.1-slim']]);
});

test('persistent transport failures stop at three attempts under one decreasing budget',{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[transient,transient,transient,transient]});
  assert.equal(result.code,1,result.output);
  assert.equal(result.failures.length,1);
  assert.equal(result.calls.filter(args=>args[0]==='pull').length,3);
  const starts=result.output.split('\n').filter(line=>line.startsWith('conformance_setup='))
    .map(line=>JSON.parse(line.slice('conformance_setup='.length)))
    .filter(record=>record.event==='start'&&record.args[0]==='pull');
  assert.equal(starts.length,3);
  assert.ok(starts[0].timeoutMs<=300000);
  assert.ok(starts[1].timeoutMs<starts[0].timeoutMs-900,'include the first backoff in the deadline');
  assert.ok(starts[2].timeoutMs<starts[1].timeoutMs-1900,'include the second backoff in the deadline');
  assert.equal(result.output.includes('PREPARED'),false);
});

test('exhausted shared budget stops without a fresh retry deadline',{timeout:5000},async t=>{
  const result=await prepare(t,{failures:[transient],expiredBudget:true});
  assert.equal(result.code,1,result.output);
  assert.equal(result.calls.filter(args=>args[0]==='pull').length,1);
  assert.equal(result.output.includes('retrying'),false);
});

test('hanging acquisition is killed at its original supervised deadline',{timeout:5000},async t=>{
  const result=await prepare(t,{hang:true,shortTimeout:true});
  assert.equal(result.code,1,result.output);
  assert.match(result.output,/Conformance setup timed out/);
  assert.equal(result.calls.filter(args=>args[0]==='pull').length,1);
  assert.throws(()=>process.kill(result.pid,0),{code:'ESRCH'});
});

for(const signal of ['SIGINT','SIGTERM'])test('interruption during image retry backoff stops setup: '+signal,{timeout:5000},async t=>{
  const result=await prepare(t,{failures:[transient],interrupt:signal});
  assert.equal(result.code,1,result.output);
  assert.equal(result.calls.filter(args=>args[0]==='pull').length,1);
  assert.equal(result.output.includes('PREPARED'),false);
});

// A deadline that expires while waiting must not authorize a second external process.
test('budget expiring during backoff refuses before spawning another pull',{timeout:5000},async t=>{
  const result=await prepare(t,{failures:[transient],expireDuringBackoff:true});
  assert.equal(result.code,1,result.output);
  assert.equal(result.calls.filter(args=>args[0]==='pull').length,1);
  assert.match(result.output,/retrying/);
  assert.match(result.output,/Conformance image acquisition timed out/);
});
