import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Dropping the source-install observer must hide the unfinished download and fail this test.
for(const outcome of ['timeout','failure','complete','interrupt'])test('setup identifies unfinished installation work on '+outcome,{timeout:15000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'cost-install-diagnostic-')),bin=join(root,'bin'),marker=join(root,'owned.json');
  mkdirSync(bin);
  writeFileSync(join(bin,'git'),`#!${process.execPath}
import {mkdirSync} from 'node:fs';
const a=process.argv.slice(2);if(a[0]==='init')mkdirSync(a.at(-1),{recursive:true});
if(a.includes('rev-parse'))console.log('fbadd15785464e59747e697c11048bfbc6e4938f');
`,{mode:0o700});
  writeFileSync(join(bin,'pnpm'),`#!${process.execPath}
import {writeFileSync} from 'node:fs';import {dirname} from 'node:path';
writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,scratch:dirname(process.cwd()),args:process.argv.slice(2)}));
for(const record of [
{name:'pnpm:progress',packageId:'typescript@7.0.0',status:'resolved'},
{name:'pnpm:progress',packageId:'esbuild@0.28.2',status:'resolved'},
{name:'pnpm:progress',packageId:'esbuild@0.28.2',status:'fetched'},
{name:'pnpm:fetching-progress',packageId:'typescript@7.0.0',status:'started',attempt:1,size:9000},
{name:'pnpm:fetching-progress',packageId:'typescript@7.0.0',status:'in_progress',downloaded:1000}
])console.log(JSON.stringify({...record,hostname:'private-host',message:'generated-install-secret',url:'https://secret.invalid/token'}));
if(${JSON.stringify(outcome)}==='failure')process.exit(23);
if(${JSON.stringify(outcome)}==='complete')process.exit(0);
setInterval(()=>{},1000);
`,{mode:0o700});
  const clock='const original=setTimeout,interval=setInterval;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===300000?1000:ms,...args);globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===10000?50:ms,...args);';
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(clock),new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
    {env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  try {
    if(outcome==='interrupt'){
      for(let n=0;n<200&&!output.includes('\"downloaded\":1000');n++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.ok(output.includes('\"downloaded\":1000'),'wait for the observed download before interrupting');child.kill('SIGTERM');
    }
    const result=await Promise.race([closed,delay(6000,null,{ref:false})]);
    assert.notEqual(result,null,'the installer must release its timers and close within the bounded observation');
    assert.deepEqual(result,{code:1,signal:null});
    assert.ok(existsSync(marker),'reach the real source-install supervisor');
    const owned=JSON.parse(readFileSync(marker));
    const records=output.split('\n').filter(l=>l.startsWith('conformance_setup=')).map(l=>JSON.parse(l.slice(18)));
    const summaries=records.filter(r=>r.phase==='source-install'&&r.event==='install-progress');
    const summary=summaries.at(-1);
    assert.ok(summary,'identify the unfinished package rather than only pnpm');
    assert.deepEqual(summary.pendingDownloads,[{packageId:'typescript@7.0.0',attempt:1,size:9000,downloaded:1000}]);
    assert.deepEqual(summary.pendingImports,['esbuild@0.28.2']);
    assert.equal(summary.resolved,2);assert.equal(summary.available,1);
    if(outcome==='timeout'){
      const timeout=records.findIndex(r=>r.phase==='source-install'&&r.event==='timeout'&&r.timeoutMs===300000);
      assert.ok(summaries.some(s=>s.pendingDownloads.length===1&&records.indexOf(s)<timeout),'report unfinished work while the command is still running');
      assert.ok(records.find(r=>r.phase==='source-install'&&r.event==='closed'&&r.signal==='SIGKILL'));
    } else if(outcome==='interrupt')assert.ok(records.find(r=>r.phase==='source-install'&&r.event==='interrupted'));
    else assert.ok(records.find(r=>r.phase==='source-install'&&r.event===outcome&&(r.code===(outcome==='failure'?23:0))));
    assert.deepEqual(owned.args,['install','--frozen-lockfile','--reporter=ndjson']);
    for(const secret of ['generated-install-secret','private-host','secret.invalid'])assert.equal(output.includes(secret),false);
    assert.equal(existsSync(owned.scratch),false);assert.throws(()=>process.kill(owned.pid,0),{code:'ESRCH'});
  } finally {
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
    if(existsSync(marker)){
      const owned=JSON.parse(readFileSync(marker));try{process.kill(owned.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
      rmSync(owned.scratch,{recursive:true,force:true});
    }
    rmSync(root,{recursive:true,force:true});
  }
});
