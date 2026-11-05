import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const runtime=fileURLToPath(new URL('./local-stack-runtime.test.ts',import.meta.url));

// Removing command-result evidence or collecting state outside the owned project must fail these controls.
for(const scenario of ['exit','timeout','state-refusal','state-timeout','cleanup-refusal','cleanup-timeout','state-ignores-term',
 'state-malformed','state-lines','state-oversized','state-hostile']){
 test(`translation startup preserves ${scenario} evidence and cleans up its project`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'translation-diagnostic-'));
  try{
   const calls=join(directory,'calls.jsonl'),pidFile=join(directory,'state.pid');
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
 else if(${JSON.stringify(scenario)}==='state-timeout'||${JSON.stringify(scenario)}==='state-ignores-term'){
  appendFileSync(${JSON.stringify(pidFile)},String(process.pid));
  if(${JSON.stringify(scenario)}==='state-ignores-term')process.on('SIGTERM',()=>{});
  setInterval(()=>{},1000);
 }
 else if(${JSON.stringify(scenario)}==='state-malformed')console.log('{private-state-secret');
 else if(${JSON.stringify(scenario)}==='state-oversized')process.stdout.write('private-state-secret'.repeat(2048));
 else {
  const hostile=${JSON.stringify(scenario)}==='state-hostile';
  const rows=[
  {Service:'bootstrap',State:hostile?'private-state-secret':'running',Health:hostile?'private-state-secret':'',ExitCode:hostile?'private-state-secret':0,Command:'private-state-secret'},
  {Service:'postgres',State:'created',Health:'',ExitCode:0},
  {Service:'migrate',State:'exited',Health:'unhealthy',ExitCode:1},
  {Service:'translation-worker',State:'restarting',Health:'starting',ExitCode:2},
  {Service:'foreign-private-state-secret',State:'running',Health:'',ExitCode:0}
  ];
  console.log(${JSON.stringify(scenario)}==='state-lines'?rows.map(row=>JSON.stringify(row)).join('\\n'):JSON.stringify(rows));
 }
}else if(command==='down'){
 if(${JSON.stringify(scenario)}==='cleanup-refusal')process.exit(1);
 else if(${JSON.stringify(scenario)}==='cleanup-timeout')setTimeout(()=>process.exit(0),2500);
 else process.exit(0);
}
else process.exit(92);
`,{mode:0o700});
   const env:NodeJS.ProcessEnv={...process.env,PATH:directory+':'+process.env.PATH,TMPDIR:directory};
   delete env.NODE_TEST_CONTEXT;
   const start=performance.now();
   const result=spawnSync(process.execPath,['--test',scenario==='cleanup-timeout'?'--test-timeout=2000':'--test-timeout=30000',runtime],{
    encoding:'utf8',env,timeout:scenario==='state-ignores-term'?7000:29000,killSignal:'SIGKILL',
   });
   if(result.signal==='SIGKILL'){
    const pid=Number(await readFile(pidFile,'utf8').catch(()=>''));
    if(pid>0)try{process.kill(pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
   }
   const output=result.stdout+result.stderr;
   assert.equal(result.status,1,output);
   assert.match(output,/compose-result /,'the original failure needs structured child evidence');
   assert.match(output,/"command":\["up","-d","--no-build","translation-worker"\]/);
   assert.match(output,/"elapsedMs":\d+/);
   assert.match(output,/bootstrap Waiting/,'Compose output must survive cleanup and timeout errors');
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
   else if(scenario==='state-ignores-term'){
    assert.match(output,/"stateErrorCode":"ETIMEDOUT"/);
    assert.match(output,/"stateSignal":"SIGKILL"/);
    assert.ok(performance.now()-start<6500,'a state reader ignoring SIGTERM must leave time for cleanup');
   }
   else if(scenario==='state-malformed')assert.match(output,/"stateParseError":true,"services":\[\]/);
   else if(scenario==='state-oversized')assert.match(output,/"stateErrorCode":"ENOBUFS","stateParseError":false,"services":\[\]/);
   else{
    assert.match(output,scenario==='state-hostile'?/"service":"bootstrap","state":null,"health":null,"exitCode":null/:/"service":"bootstrap","state":"running","health":"","exitCode":0/);
    assert.match(output,/"service":"postgres","state":"created","health":"","exitCode":0/);
    assert.match(output,/"service":"migrate","state":"exited","health":"unhealthy","exitCode":1/);
    assert.match(output,/"service":"translation-worker","state":"restarting","health":"starting","exitCode":2/);
   }
   assert.doesNotMatch(output,/private-state-secret/);
   const commands=(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]).filter(args=>args[0]==='compose');
   assert.equal(commands.length,scenario==='cleanup-refusal'?4:3,'one failed start, state evidence and cleanup');
   const [up,state,down]=commands;
   assert.ok(up&&state&&down);
   const project=up[up.indexOf('--project-name')+1];
   assert.ok(project);
   assert.match(project,/^translation-runtime-[0-9a-f-]{36}$/);
   for(const args of commands)assert.equal(args[args.indexOf('--project-name')+1],project);
   assert.deepEqual(state.slice(-4),['ps','--all','--format','json']);
   assert.deepEqual(down.slice(-3),['down','--volumes','--remove-orphans']);
   if(scenario==='cleanup-refusal')assert.match(output,/"command":\["down","--volumes","--remove-orphans"\],"status":1/);
   if(scenario==='cleanup-timeout')assert.match(output,/test timed out after 2000ms/);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
}
