import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Removing command context or reporting a failed command as complete must fail these cases.
for(const outcome of ['timeout','failure'])test('setup identifies the active command on '+outcome,{timeout:12000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'cost-setup-diagnostic-')),bin=join(root,'bin'),marker=join(root,'entered.json');
  mkdirSync(bin);
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  writeFileSync(join(bin,'git'),`#!${process.execPath}
import {writeFileSync} from 'node:fs';import {spawn,spawnSync} from 'node:child_process';import {dirname} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='rev-parse'){const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);}
if(args[0]!=='init')process.exit(91);
const record={pid:process.pid,scratch:dirname(args.at(-1)),args};
if(${JSON.stringify(outcome)}==='failure'){writeFileSync(${JSON.stringify(marker)},JSON.stringify(record));process.exit(23);}
const grandchild=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
grandchild.once('message',()=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({...record,grandchild:grandchild.pid})));setInterval(()=>{},1000);
`,{mode:0o700});
  // Accelerate only the existing command deadline in this disposable observer process.
  const clock='const original=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,ms===300000?1000:ms,...args);';
  const child=spawn(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(clock),new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
    {env:{...process.env,PATH:bin+':'+process.env.PATH,NODE_AUTH_TOKEN:'generated-diagnostic-secret'},stdio:['ignore','pipe','pipe']});
  let output='',owned;
  child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
  const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  try {
    const result=await Promise.race([closed,delay(6000,undefined,{ref:false}).then(()=>null)]);
    assert.notEqual(result,null,'the unchanged command deadline must settle setup');
    assert.equal(existsSync(marker),true,'exercise the real command supervisor with a controlled external git process');
    owned=JSON.parse(readFileSync(marker));
    assert.equal(result.code,1);assert.equal(result.signal,null);
    const records=output.split('\n').filter(line=>line.startsWith('conformance_setup=')).map(line=>JSON.parse(line.slice('conformance_setup='.length)));
    const started=records.find(record=>record.phase==='source-init'&&record.event==='start');
    assert.ok(started,'report the command before it can stall');
    assert.equal(started.command,'git');assert.deepEqual(started.args,owned.args);assert.equal(started.pid,owned.pid);
    assert.equal(started.timeoutMs,300000,'retain the existing five-minute command deadline');
    const ended=records.find(record=>record.phase==='source-init'&&record.event===outcome);
    assert.ok(ended,'identify the refusing phase instead of a generic setup error');
    assert.equal(ended.command,'git');assert.deepEqual(ended.args,owned.args);assert.equal(ended.pid,owned.pid);
    assert.ok(Number.isFinite(ended.elapsedMs)&&ended.elapsedMs>=0);
    assert.equal(ended.timeoutMs,300000);
    assert.equal(records.some(record=>record.phase==='source-init'&&record.event==='complete'),false);
    const revision=records.find(record=>record.phase==='revision'&&record.event==='complete');
    assert.ok(revision,'a completed earlier command must be distinguishable from the stalled command');
    assert.equal(revision.code,0);
    if(outcome==='timeout'){assert.ok(ended.elapsedMs>=900);assert.match(output,/Conformance setup timed out/);}
    else {assert.equal(ended.code,23);assert.match(output,/Conformance setup command failed/);}
    assert.equal(output.includes('generated-diagnostic-secret'),false,'never include the environment in command diagnostics');
    assert.equal(existsSync(owned.scratch),false);
    assert.throws(()=>process.kill(owned.pid,0),{code:'ESRCH'});
    if(owned.grandchild){
      for(let n=0;n<50;n++){try{process.kill(owned.grandchild,0);await delay(20);}catch(error){if(error.code==='ESRCH')break;throw error;}}
      assert.throws(()=>process.kill(owned.grandchild,0),{code:'ESRCH'},'timeout still collects this command’s descendants');
    }
  } finally {
    if(!owned&&existsSync(marker))owned=JSON.parse(readFileSync(marker));
    if(owned){for(const pid of [owned.pid,owned.grandchild].filter(Boolean)){try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
      if(existsSync(owned.scratch))rmSync(owned.scratch,{recursive:true,force:true});}
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
    rmSync(root,{recursive:true,force:true});
  }
});
