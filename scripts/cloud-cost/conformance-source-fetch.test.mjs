import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Missing retries, partial-checkout cleanup, bounds or refusal classification
// must prevent these real preparation children from reaching installation.
async function prepare(t,scenario={}) {
  const root=await mkdtemp(join(tmpdir(),'cost-source-fetch-')),bin=join(root,'bin'),state=join(root,'state.json');
  await mkdir(bin);
  await writeFile(state,JSON.stringify({calls:[],pids:[],failures:[],...scenario}));
  await writeFile(join(bin,'git'),`#!${process.execPath}
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {join,dirname} from 'node:path';
const path=${JSON.stringify(state)},data=JSON.parse(readFileSync(path)),args=process.argv.slice(2);
data.calls.push(args);writeFileSync(path,JSON.stringify(data));
if(args[0]==='init'){
 const source=args.at(-1);data.scratch=dirname(source);
 if(existsSync(join(source,'partial'))) {console.error('Uncollected partial checkout');process.exit(89);}
 mkdirSync(source,{recursive:true});writeFileSync(path,JSON.stringify(data));
}else if(args.includes('fetch')){
 data.pids.push(process.pid);const failure=data.failures.shift();writeFileSync(path,JSON.stringify(data));
 if(failure){writeFileSync(join(args[args.indexOf('-C')+1],'partial'),'generated');
  if(failure==='hang')setInterval(()=>{},1000);
  else {console.error(failure);process.exit(128);}
 }
}else if(args.includes('rev-parse'))console.log(data.wrongRevision?'wrong-revision':'fbadd15785464e59747e697c11048bfbc6e4938f');
else if(!args.includes('checkout'))process.exit(90);
`,{mode:0o700});
  await writeFile(join(bin,'pnpm'),`#!${process.execPath}\nconsole.error('REACHED_SOURCE_INSTALL');process.exit(73);\n`,{mode:0o700});
  // Accelerate supervisor time only in this disposable child; retain reported limits.
  const clock='const timer=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms===300000?2500:ms===75000?350:ms,...args);';
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(clock),new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
    {env:{...process.env,PATH:bin+':'+process.env.PATH,NODE_AUTH_TOKEN:'generated-fetch-secret'},stdio:['ignore','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
    const data=JSON.parse(await readFile(state,'utf8'));
    for(const pid of data.pids){try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
    if(data.scratch)await rm(data.scratch,{recursive:true,force:true});
    await rm(root,{recursive:true,force:true});
  });
  let output='',interrupted=false;
  const collect=bytes=>{
    output+=bytes;
    if(scenario.interrupt&&!interrupted&&output.includes('"phase":"source-fetch"')&&output.includes('"event":"start"')){
      interrupted=true;child.kill(scenario.interrupt);
    }
  };
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  const result=await Promise.race([closed,delay(5000,null,{ref:false})]);
  assert.notEqual(result,null,'bounded fetch attempts must settle preparation');
  assert.deepEqual(result,{code:1,signal:null});
  const data=JSON.parse(await readFile(state,'utf8'));
  assert.equal(existsSync(data.scratch),false,'collect all owned setup files on refusal');
  for(const pid of data.pids)assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'collect each fetch child');
  assert.equal(output.includes('generated-fetch-secret'),false);
  const records=output.split('\n').filter(line=>line.startsWith('conformance_setup='))
    .map(line=>JSON.parse(line.slice('conformance_setup='.length)));
  return {...data,output,fetches:records.filter(record=>record.phase==='source-fetch')};
}

for(const failure of ['hang',"fatal: unable to access 'https://github.com/clintongormley/waitron.git/': Failed to connect to github.com port 443: Operation timed out",
  'fatal: unable to access public source: Operation too slow. Less than 1000 bytes/sec transferred the last 60 seconds']) {
  test('source fetch recovers once after '+failure,{timeout:7000},async t=>{
    const result=await prepare(t,{failures:[failure]});
    assert.match(result.output,/REACHED_SOURCE_INSTALL/);
    assert.equal(result.calls.filter(args=>args[0]==='init').length,2,'reinitialise after removing the partial checkout');
    const starts=result.fetches.filter(record=>record.event==='start');
    assert.deepEqual(starts.map(record=>record.attempt),[1,2]);
    for(const record of starts){
      assert.equal(record.timeoutMs,75000);
      assert.ok(record.args.includes('http.lowSpeedLimit=1000'));
      assert.ok(record.args.includes('http.lowSpeedTime=60'));
      assert.equal(record.args.at(-1),'fbadd15785464e59747e697c11048bfbc6e4938f');
    }
    assert.equal(result.fetches.at(-1).event,'complete');
    assert.ok(result.fetches.every(record=>Number.isFinite(record.elapsedMs)));
    if(failure!=='hang')assert.ok(result.output.includes(failure),'retain git’s own refusal');
    else assert.ok(result.fetches.some(record=>record.event==='timeout'&&record.attempt===1));
  });
}

test('two stalled attempts fail within the bound without checkout or installation',{timeout:7000},async t=>{
  const result=await prepare(t,{failures:['hang','hang','hang']});
  assert.deepEqual(result.fetches.filter(record=>record.event==='start').map(record=>record.attempt),[1,2]);
  assert.equal(result.fetches.filter(record=>record.event==='timeout').length,2);
  assert.equal(result.calls.some(args=>args.includes('checkout')),false);
  assert.equal(result.output.includes('REACHED_SOURCE_INSTALL'),false);
});

for(const refusal of ['fatal: remote error: upload-pack: not our ref abc',
  "fatal: couldn't find remote ref missing; Operation timed out",
  'fatal: Authentication failed; connection reset by peer',
  'fatal: unexpected local failure']) {
  test('source fetch refuses without retry: '+refusal,{timeout:7000},async t=>{
    const result=await prepare(t,{failures:[refusal]});
    assert.equal(result.calls.filter(args=>args.includes('fetch')).length,1);
    assert.equal(result.calls.some(args=>args.includes('checkout')),false);
    assert.ok(result.output.includes(refusal));
    assert.equal(result.output.includes('REACHED_SOURCE_INSTALL'),false);
  });
}

test('healthy fetch checks out and verifies the pinned source without retry',async t=>{
  const result=await prepare(t);
  assert.match(result.output,/REACHED_SOURCE_INSTALL/);
  assert.equal(result.calls.filter(args=>args.includes('fetch')).length,1);
  assert.equal(result.calls.filter(args=>args.includes('checkout')).length,1);
});

test('a different checked-out revision cannot proceed to installation',async t=>{
  const result=await prepare(t,{wrongRevision:true});
  assert.equal(result.calls.filter(args=>args.includes('fetch')).length,1);
  assert.match(result.output,/Unexpected public source/);
  assert.equal(result.output.includes('REACHED_SOURCE_INSTALL'),false);
});

for(const interrupt of ['SIGINT','SIGTERM'])test('interrupted fetch does not retry: '+interrupt,{timeout:7000},async t=>{
  const result=await prepare(t,{failures:['hang'],interrupt});
  assert.equal(result.fetches.filter(record=>record.event==='start').length,1);
  assert.equal(result.output.includes('REACHED_SOURCE_INSTALL'),false);
  assert.match(result.output,/Conformance setup interrupted/);
});
