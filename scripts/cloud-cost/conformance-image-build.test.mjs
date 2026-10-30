import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const metadata='ERROR: failed to build: failed to solve: node:26.11.1-slim: failed to resolve source metadata: unexpected status from HEAD request to https://registry-1.docker.io/v2/library/node/manifests/26.11.1-slim: 502 Bad Gateway';

// The preparer owns real child supervision; only network archives and external commands are substituted.
async function prepare(t,scenario={}) {
  const root=await mkdtemp(join(tmpdir(),'cost-image-build-')),bin=join(root,'bin'),state=join(root,'state.json');
  await mkdir(bin);await writeFile(state,JSON.stringify({calls:[],failures:[],...scenario}));
  await writeFile(join(bin,'docker'),`#!${process.execPath}
import {readFileSync,writeFileSync} from 'node:fs';
const path=${JSON.stringify(state)},data=JSON.parse(readFileSync(path)),args=process.argv.slice(2);
data.calls.push(args);writeFileSync(path,JSON.stringify(data));
if(args[0]==='info')console.log('x86_64');
else if(args[0]==='build') {
  if(data.hang){data.pid=process.pid;writeFileSync(path,JSON.stringify(data));setInterval(()=>{},1000);}
  else if(data.failures.length){const refusal=data.failures.shift();writeFileSync(path,JSON.stringify(data));console.error(refusal);process.exit(1);}
} else if(args[0]==='image'&&args[1]==='inspect')console.log('sha256:'+'a'.repeat(64));
else if(args[0]==='image'&&args[1]==='ls')console.log('owned-image');
else if(args[0]!=='image'||args[1]!=='rm')process.exit(91);
`,{mode:0o700});
  await writeFile(join(bin,'tar'),`#!${process.execPath}
import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const args=process.argv.slice(2);for(const name of ['litestream','weed'])writeFileSync(join(args[args.indexOf('-C')+1],name),'generated');
`,{mode:0o700});
  const program=`
import fs from 'node:fs';import {registerHooks,syncBuiltinESMExports} from 'node:module';
registerHooks({load(url,context,next){
  if(url===${JSON.stringify(new URL('./conformance-archive.mjs',import.meta.url).href)})return {format:'module',shortCircuit:true,source:"import {writeFileSync} from 'node:fs';export async function downloadConformanceArchive(url,digest,path){writeFileSync(path,'generated');}"};
  return next(url,context);
}});
const now=performance.now.bind(performance);let firstBuild;
${scenario.expiredBudget||scenario.expireDuringBackoff?`Object.defineProperty(performance,'now',{value:()=>{const elapsed=now();if(JSON.parse(fs.readFileSync(${JSON.stringify(state)})).calls.some(args=>args[0]==='build'))firstBuild??=elapsed;return elapsed+(firstBuild!==undefined&&${scenario.expiredBudget?'true':'elapsed-firstBuild>500'}?301000:0);}});`:''}
${scenario.shortTimeout?"const timer=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms>290000?1000:ms,...args);":''}
${scenario.interrupt?"const timers=await import('node:timers/promises');const timer=timers.default.setTimeout;timers.default.setTimeout=(ms,...args)=>timer(ms===1000?30000:ms,...args);syncBuiltinESMExports();":''}
const {prepareConformance}=await import(${JSON.stringify(new URL('./conformance-prepare.mjs',import.meta.url).href)});
const fixture=await prepareConformance(['worker-storage-conformance.test.mjs']);
try {console.log('PREPARED='+JSON.stringify(JSON.parse(fs.readFileSync(fixture.env.COST_STACK_FIXTURE))));}finally{fixture.cleanup();}
`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:root},stdio:['ignore','pipe','pipe']});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
    const data=JSON.parse(await readFile(state,'utf8'));
    if(data.pid)try{process.kill(data.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    await rm(root,{recursive:true,force:true});
  });
  let output='',interrupted=false;
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{
    output+=bytes;
    if(scenario.interrupt&&!interrupted&&output.includes('retrying fixture image')){interrupted=true;child.kill(scenario.interrupt);}
  });
  const result=await closed,data=JSON.parse(await readFile(state,'utf8'));
  const builds=data.calls.filter(args=>args[0]==='build');
  assert.ok(builds.length>0,'reach the actual image build');
  assert.equal(existsSync(join(builds[0].at(-1),'..')),false,'collect owned setup scratch');
  const tag=builds[0][builds[0].indexOf('-t')+1];
  assert.deepEqual(data.calls.slice(-2),[['image','ls','-q',tag],['image','rm',tag]],'remove only the owned image tag');
  for(const args of builds)assert.deepEqual(args,builds[0],'reuse the same verified build context and owned tag');
  return {...result,...data,output,builds};
}

// Without the retry, this exact recorded metadata refusal prevents fixture preparation.
test('fixture build recovers from the observed Docker Hub metadata HTTP 502',{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[metadata]});
  assert.equal(result.code,0,result.output);
  assert.match(result.output,/PREPARED=/);
  assert.equal(result.builds.length,2);
  assert.match(result.output,/502 Bad Gateway/,'retain the original refusal');
});

for(const status of [500,503,504])test('fixture build recovers from Docker Hub metadata HTTP '+status,{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[metadata.replace('502 Bad Gateway',status+' Unavailable')]});
  assert.equal(result.code,0,result.output);assert.equal(result.builds.length,2);
});

test('successful fixture build needs one attempt',async t=>{
  const result=await prepare(t);
  assert.equal(result.code,0,result.output);assert.equal(result.builds.length,1);
  const prepared=JSON.parse(result.output.split('\n').find(line=>line.startsWith('PREPARED=')).slice(9));
  assert.equal(prepared.image,'sha256:'+'a'.repeat(64));
});

for(const refusal of [
  'ERROR: failed to solve: process "/bin/sh -c install" did not complete successfully: exit code: 1',
  'ERROR: failed to build: unexpected EOF',
  metadata.replace('502 Bad Gateway','404 Not Found'),
  metadata.replace('registry-1.docker.io','example.invalid'),
  metadata.replace('failed to resolve source metadata','RUN application'),
  metadata+'\nunauthorized: authentication required',
  metadata+'\nmanifest unknown',metadata+'\ntoomanyrequests: rate limit exceeded',
  metadata+'\ndenied: requested access',metadata+'\ninvalid reference format'
])test('non-transient build refusal stops immediately: '+refusal.split('\n').at(-1),{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[refusal]});
  assert.equal(result.code,1,result.output);assert.equal(result.builds.length,1);
  assert.equal(result.output.includes('PREPARED='),false);
  assert.equal(result.output.includes('retrying fixture image'),false);
});

test('persistent metadata refusal stops at three builds under a decreasing budget',{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[metadata,metadata,metadata,metadata]});
  assert.equal(result.code,1,result.output);assert.equal(result.builds.length,3);assert.equal(result.failures.length,1);
  const starts=result.output.split('\n').filter(line=>line.startsWith('conformance_setup='))
    .map(line=>JSON.parse(line.slice('conformance_setup='.length)))
    .filter(record=>record.phase==='fixture-image-build'&&record.event==='start');
  assert.deepEqual(starts.map(record=>record.attempt),[1,2,3]);
  assert.ok(starts[0].timeoutMs<=300000);
  assert.ok(starts[1].timeoutMs<starts[0].timeoutMs-900);
  assert.ok(starts[2].timeoutMs<starts[1].timeoutMs-1900);
});

for(const scenario of ['expiredBudget','expireDuringBackoff'])test('exhausted build budget refuses without another child: '+scenario,{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[metadata],[scenario]:true});
  assert.equal(result.code,1,result.output);assert.equal(result.builds.length,1);
  assert.equal(result.output.includes('PREPARED='),false);
  if(scenario==='expireDuringBackoff')assert.match(result.output,/Conformance fixture image build timed out/);
  else assert.equal(result.output.includes('retrying fixture image'),false);
});

test('a hanging build is killed at its supervised deadline',{timeout:10000},async t=>{
  const result=await prepare(t,{hang:true,shortTimeout:true});
  assert.equal(result.code,1,result.output);assert.equal(result.builds.length,1);
  assert.match(result.output,/Conformance setup timed out/);
  assert.throws(()=>process.kill(result.pid,0),{code:'ESRCH'});
});

for(const signal of ['SIGINT','SIGTERM'])test('interruption during build backoff collects setup: '+signal,{timeout:10000},async t=>{
  const result=await prepare(t,{failures:[metadata],interrupt:signal});
  assert.equal(result.code,1,result.output);assert.equal(result.builds.length,1);
  assert.match(result.output,/Conformance setup interrupted/);
  assert.equal(result.output.includes('PREPARED='),false);
});
