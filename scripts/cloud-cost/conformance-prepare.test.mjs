import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Interrupting a blocked setup child must collect both that child and its owned scratch.
for(const signal of ['SIGINT','SIGTERM'])test('setup collects its child and scratch after '+signal,{timeout:12000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'cost-setup-cancel-')),bin=join(root,'bin'),marker=join(root,'entered.json');
  mkdirSync(bin);
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();
  writeFileSync(join(bin,'git'),`#!${process.execPath}
import {writeFileSync} from 'node:fs';import {spawn,spawnSync} from 'node:child_process';import {dirname} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='rev-parse'){const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);}
const grandchild=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)\"],{stdio:['ignore','ignore','ignore','ipc']});
grandchild.once('message',()=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,grandchild:grandchild.pid,scratch:dirname(args.at(-1))})));setInterval(()=>{},1000);
`,{mode:0o700});
  const child=spawn(process.execPath,[new URL('./conformance.mjs',import.meta.url).pathname,'--only','cadence-conformance.test.mjs'],
    {env:{...process.env,PATH:bin+':'+process.env.PATH},stdio:'ignore'});
  const closed=new Promise(resolve=>child.once('close',(code,endedSignal)=>resolve({code,signal:endedSignal})));
  let owned;
  try{
    const until=Date.now()+4000;while(!existsSync(marker)&&Date.now()<until)await delay(20);
    assert.equal(existsSync(marker),true,'reach the setup process before interrupting');
    owned=JSON.parse(readFileSync(marker));child.kill(signal);
    const result=await Promise.race([closed,delay(3000).then(()=>null)]);
    assert.notEqual(result,null,'an interrupt must settle the setup child promptly');
    assert.ok(result.code!==0||result.signal,'interruption cannot report success');
    assert.equal(existsSync(owned.scratch),false,'collect the scratch even before fixture preparation returns');
    assert.throws(()=>process.kill(owned.pid,0),{code:'ESRCH'},'collect only the recorded setup child');
    for(let n=0;n<25;n++){try{process.kill(owned.grandchild,0);await delay(20);}catch(error){if(error.code==='ESRCH')break;throw error;}}
    assert.throws(()=>process.kill(owned.grandchild,0),{code:'ESRCH'},'collect setup descendants even when they ignore SIGTERM');
  }finally{
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;
    if(owned){for(const pid of [owned.pid,owned.grandchild]){try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}
      if(existsSync(owned.scratch))rmSync(owned.scratch,{recursive:true,force:true});}
    rmSync(root,{recursive:true,force:true});
  }
});
