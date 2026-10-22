import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test,type TestContext} from 'node:test';
import {promisify} from 'node:util';

const execute=promisify(execFile),root=fileURLToPath(new URL('../../../',import.meta.url));
async function controlledDocker(t:TestContext,scenario:string){
 const directory=await mkdtemp(join(tmpdir(),'cloud-fixture-image-')),log=join(directory,'commands.jsonl');
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(join(directory,'docker'),`#!${process.execPath}
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2),log=process.env.FIXTURE_DOCKER_LOG,scenario=process.env.FIXTURE_DOCKER_SCENARIO;
const prior=existsSync(log)?readFileSync(log,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse):[];
appendFileSync(log,JSON.stringify({args,pid:process.pid})+'\\n');
const fail=message=>{console.error(message);process.exit(1);};
if(args[0]==='image'&&args[1]==='inspect'){
 if(args[2]!=='node:26'){
  if(prior.some(row=>row.args[0]==='build')&&['cached','run-failed','run-refused','cleanup-refused','tagged-failure'].includes(scenario))console.log('owned-image');
  else fail('Error response from daemon: No such image: '+args[2]);
 }else if(scenario==='inspect-denied')fail('Cannot connect to the Docker daemon');
 else if(['cached','run-failed','run-refused','cleanup-refused','tagged-failure'].includes(scenario))console.log('local-image');else fail('Error response from daemon: No such image: node:26');
}else if(args[0]==='pull'){
 if(scenario==='denied')fail('unauthorized: authentication required');
 if(scenario==='exhausted'||scenario==='transient'&&!prior.some(row=>row.args[0]==='pull'))fail('unexpected status: 502 Bad Gateway');
 if(scenario==='timeout')setTimeout(()=>fail('hung beyond short test budget'),1200);
}else if(args[0]==='build'){
 if(!['cached','success','run-failed','run-refused','cleanup-refused'].includes(scenario))fail('fixture build failed');
}else if(args[0]==='run'&&scenario==='run-failed')fail('fixture container created but start failed');
else if(args[0]==='run'&&scenario==='run-refused')fail('fixture container creation refused');
else if(args[0]==='run'&&scenario==='cleanup-refused')fail('fixture container created but start failed');
else if(args[0]==='rm'&&scenario==='cleanup-refused')fail('fixture cleanup daemon refused');
else if(args[0]==='image'&&args[1]==='rm'&&!['run-failed','run-refused','cleanup-refused','tagged-failure'].includes(scenario))fail('No such image: never built');
else if(args[0]==='port')console.log('127.0.0.1:59999');
`,{mode:0o755});
 const env:NodeJS.ProcessEnv={...process.env,PATH:directory+':'+process.env.PATH,FIXTURE_DOCKER_LOG:log,FIXTURE_DOCKER_SCENARIO:scenario};
 delete env.NODE_TEST_CONTEXT;
 return {directory,env,async commands(){return (await readFile(log,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {args:string[];pid:number});}};
}
async function setupFailure(env:NodeJS.ProcessEnv){
 try{
  await execute(process.execPath,['--test','packages/backups/test/verification-infrastructure.test.ts'],{cwd:root,env,timeout:15000});
  assert.fail('the deliberately broken build must fail setup');
 }catch(error){
  const failure=error as Error&{code:number;stdout:string;stderr:string};
  assert.equal(failure.code,1);
  assert.match(failure.stdout+failure.stderr,/fixture build failed|authentication required|fixture container created but start failed|fixture container creation refused/);
  return failure.stdout+failure.stderr;
 }
}

// These run the suite's actual setup/cleanup hooks with only the Docker boundary controlled.
test('outage fixture retries transient base acquisition before one build attempt',async(t)=>{
 const f=await controlledDocker(t,'transient');await setupFailure(f.env);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='pull').length,2);
 assert.equal(commands.filter(args=>args[0]==='build').length,1);
});

test('failed outage fixture build never removes an image it did not create',async(t)=>{
 const f=await controlledDocker(t,'transient');await setupFailure(f.env);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='image'&&args[1]==='rm').length,0);
 assert.equal(commands.filter(args=>args[0]==='run'||args[0]==='rm').length,0);
});

async function build(env:NodeJS.ProcessEnv,budget=120000){
 const module=new URL('./container-fixture/image.ts',import.meta.url).href;
 return execute(process.execPath,['--input-type=module','-e',`import {buildFixtureImage} from ${JSON.stringify(module)};const start=performance.now();try{await buildFixtureImage('owned-fixture:test',${JSON.stringify(root)},${budget});}finally{console.log(JSON.stringify({elapsedMs:performance.now()-start}));}`],{cwd:root,env,timeout:10000});
}

test('cached base image builds once without registry acquisition',async(t)=>{
 const f=await controlledDocker(t,'cached');await build(f.env);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='pull').length,0);
 assert.deepEqual(commands.filter(args=>args[0]==='build'),[['build','--pull=false','-q','-t','owned-fixture:test','-f',join(root,'packages/backups/test/container-fixture/Dockerfile'),root]]);
});

test('permanent registry refusal stops before build or container ownership',async(t)=>{
 const f=await controlledDocker(t,'denied');
 await setupFailure(f.env);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='pull').length,1);
 assert.equal(commands.filter(args=>['build','run','rm'].includes(args[0]!)||args[0]==='image'&&args[1]==='rm').length,0);
});

test('registry failures exhaust three acquisitions without building',async(t)=>{
 const f=await controlledDocker(t,'exhausted');await assert.rejects(build(f.env),/502 Bad Gateway/);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='pull').length,3);
 assert.equal(commands.filter(args=>args[0]==='build').length,0);
});

test('acquisition deadline stops its child and leaves no budget for a retry or build',async(t)=>{
 const f=await controlledDocker(t,'timeout');
 await assert.rejects(build(f.env,400),error=>{
  assert.match(String((error as {stderr:string}).stderr),/SIGKILL|timed out/);return true;
 });
 const commands=await f.commands(),pulls=commands.filter(row=>row.args[0]==='pull');
 assert.equal(pulls.length,1);
 assert.throws(()=>process.kill(pulls[0]!.pid,0),{code:'ESRCH'});
 assert.equal(commands.filter(row=>row.args[0]==='build').length,0);
});

test('fixture preparation cannot widen the existing two-minute command budget',async(t)=>{
 const f=await controlledDocker(t,'cached');
 await assert.rejects(build(f.env,120001),/fixture_image.invalid_budget/);
});

test('failed container start still removes its attempted container and built image',async(t)=>{
 const f=await controlledDocker(t,'run-failed');await setupFailure(f.env);
 const commands=(await f.commands()).map(row=>row.args),run=commands.find(args=>args[0]==='run')!;
 const name=run[run.indexOf('--name')+1]!;
 assert.deepEqual(commands.filter(args=>args[0]==='rm'),[['rm','-f','-v',name]]);
 assert.equal(commands.filter(args=>args[0]==='image'&&args[1]==='rm').length,1);
});

test('refused container creation preserves its error and still removes the built image',async(t)=>{
 const f=await controlledDocker(t,'run-refused'),output=await setupFailure(f.env);
 const commands=(await f.commands()).map(row=>row.args);
 assert.equal(commands.filter(args=>args[0]==='rm').length,1);
 assert.equal(commands.filter(args=>args[0]==='image'&&args[1]==='rm').length,1);
 assert.doesNotMatch(output,/No such container/);
});

test('container cleanup errors remain visible and cannot skip image cleanup',async(t)=>{
 const f=await controlledDocker(t,'cleanup-refused'),output=await setupFailure(f.env);
 assert.match(output,/fixture cleanup daemon refused/);
 assert.equal((await f.commands()).filter(row=>row.args[0]==='image'&&row.args[1]==='rm').length,1);
});

test('failed build that left its uniquely requested tag is cleaned up',async(t)=>{
 const f=await controlledDocker(t,'tagged-failure');await setupFailure(f.env);
 assert.equal((await f.commands()).filter(row=>row.args[0]==='image'&&row.args[1]==='rm').length,1);
});

test('daemon inspection failure cannot fall through to acquisition or build',async(t)=>{
 const f=await controlledDocker(t,'inspect-denied');await assert.rejects(build(f.env),/Cannot connect to the Docker daemon/);
 assert.deepEqual((await f.commands()).map(row=>row.args),[['image','inspect','node:26']]);
});

test('insufficient remaining budget refuses before the retry delay',async(t)=>{
 const f=await controlledDocker(t,'exhausted');
 await assert.rejects(build(f.env,500),error=>{
  const failure=error as {stderr:string;stdout:string};assert.match(failure.stderr,/502 Bad Gateway/);
  assert(JSON.parse(failure.stdout).elapsedMs<1000,'the one-second retry pause must not run');return true;
 });
 assert.equal((await f.commands()).filter(row=>row.args[0]==='pull').length,1);
});
