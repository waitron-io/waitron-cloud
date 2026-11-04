import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const runtime=fileURLToPath(new URL('./local-stack-runtime.test.ts',import.meta.url));

// Removing command-result evidence or collecting state outside the owned project must fail these controls.
for(const scenario of ['exit','timeout','state-refusal','state-timeout']){
 test(`translation startup preserves ${scenario} evidence and cleans up its project`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'translation-diagnostic-'));
  try{
   const calls=join(directory,'calls.jsonl');
   await writeFile(join(directory,'docker'),`#!${process.execPath}
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='image'&&args[1]==='inspect')process.exit(0);
if(args[0]!=='compose')process.exit(91);
const command=args[args.indexOf('--profile')+2];
if(command==='up'){
 process.stderr.write('bootstrap Waiting\\n');
 if(${JSON.stringify(scenario)}==='timeout')setInterval(()=>{},1000);
 else process.exit(255);
}else if(command==='ps'){
 if(${JSON.stringify(scenario)}==='state-refusal'){process.stderr.write('private-state-secret');process.exit(1);}
 else if(${JSON.stringify(scenario)}==='state-timeout')setInterval(()=>{},1000);
 else console.log(JSON.stringify([
  {Service:'bootstrap',State:'running',Health:'',ExitCode:0,Command:'private-state-secret'},
  {Service:'postgres',State:'created',Health:'',ExitCode:0},
  {Service:'foreign-private-state-secret',State:'running',Health:'',ExitCode:0}
 ]));
}else if(command==='down')process.exit(0);
else process.exit(92);
`,{mode:0o700});
   const env:NodeJS.ProcessEnv={...process.env,PATH:directory+':'+process.env.PATH};
   delete env.NODE_TEST_CONTEXT;
   const start=performance.now();
   const result=spawnSync(process.execPath,['--test','--test-timeout=30000',runtime],{
    encoding:'utf8',env,timeout:29000,
   });
   const output=result.stdout+result.stderr;
   assert.equal(result.status,1,output);
   assert.match(output,/compose-result /,'the original failure needs structured child evidence');
   assert.match(output,/"command":\["up","-d","--no-build","translation-worker"\]/);
   assert.match(output,/"elapsedMs":\d+/);
   if(scenario==='timeout'){
    assert.match(output,/"errorCode":"ETIMEDOUT"/);
    assert.match(output,/"signal":"SIGTERM"/);
   }else{
    assert.match(output,/"status":255/);
    assert.match(output,/"errorCode":null/);
    assert.match(output,/"signal":null/);
   }
   if(scenario==='state-refusal')assert.match(output,/"stateStatus":1/);
   else if(scenario==='state-timeout'){
    assert.match(output,/"stateErrorCode":"ETIMEDOUT"/);
    assert.ok(performance.now()-start<6500,'failed diagnostics must leave time for cleanup');
   }
   else{
    assert.match(output,/"service":"bootstrap","state":"running","health":"","exitCode":0/);
    assert.match(output,/"service":"postgres","state":"created","health":"","exitCode":0/);
   }
   assert.doesNotMatch(output,/private-state-secret/);
   const commands=(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]).filter(args=>args[0]==='compose');
   assert.equal(commands.length,3,'one failed start, one bounded state read and cleanup');
   const [up,state,down]=commands;
   assert.ok(up&&state&&down);
   const project=up[up.indexOf('--project-name')+1];
   assert.ok(project);
   assert.match(project,/^translation-runtime-[0-9a-f-]{36}$/);
   for(const args of commands)assert.equal(args[args.indexOf('--project-name')+1],project);
   assert.deepEqual(state.slice(-4),['ps','--all','--format','json']);
   assert.deepEqual(down.slice(-3),['down','--volumes','--remove-orphans']);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
}
