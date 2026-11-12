import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import {upgradeFailure} from './schema-upgrade-fixture.mjs';
const exec=promisify(execFile),root=new URL('../',import.meta.url).pathname;
// Losing either checkout label must make the real CLI's failure record incomplete.
const cases=['old','new'].flatMap(release=>['clone','checkout','install'].map(operation=>({release,operation,mode:'exit',status:73,signal:null,code:null})));
cases.push({release:'old',operation:'install',mode:'signal',status:null,signal:'SIGTERM',code:null},{release:'old',operation:'install',mode:'missing',status:null,signal:null,code:'ENOENT'},{release:'new',operation:'install',mode:'hangup',status:null,signal:'SIGHUP',code:null});
cases.push({proof:'factor',release:'old',operation:'install',mode:'exit',status:73,signal:null,code:null});
for(const {release,operation,mode,status,signal,code,proof='lifecycle'} of cases){
 test(`upgrade ${proof} CLI identifies ${release} ${operation} ${mode} refusal without child output`,async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'upgrade-command-control-'));
  try{
   const script=`#!${process.execPath}
import {mkdirSync} from 'node:fs';
import {basename} from 'node:path';
const command=basename(process.argv[1]),args=process.argv.slice(2);
const operation=command==='pnpm'?'install':args[0];
const release=operation==='clone'?basename(args.at(-1)):basename(process.cwd());
if(operation===process.env.REFUSE_OPERATION&&release===process.env.REFUSE_RELEASE){
 console.log('synthetic-private-stdout');console.error('synthetic-private-stderr');
 if(process.env.REFUSE_MODE==='signal')process.kill(process.pid,'SIGTERM');else if(process.env.REFUSE_MODE==='hangup')process.kill(process.pid,'SIGHUP');else process.exit(73);
}
if(operation==='clone')mkdirSync(args.at(-1));
`;
   for(const command of (mode==='missing'?['git']:['git','pnpm']))await writeFile(join(scratch,command),script,{mode:0o700});
   await writeFile(join(scratch,'docker'),`#!${process.execPath}\nif(process.argv[2]==='run')process.exit(97);\n`,{mode:0o700});
   const output=join(scratch,'receipt.json'),env={...process.env,PATH:mode==='missing'?scratch:scratch+':'+process.env.PATH,REFUSE_RELEASE:release,REFUSE_OPERATION:operation,REFUSE_MODE:mode};
   delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
   let failure;
   try{await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output,...(proof==='lifecycle'?['--lifecycle']:[]),'--old','a'.repeat(40),'--new','b'.repeat(40)],{cwd:root,env,timeout:15000});}catch(error){failure=error;}
   assert.equal(failure?.code,1,'the proof must still fail');
   if(proof==='lifecycle'){
    const record=JSON.parse(failure.stderr.split('\n').find(line=>line.startsWith('{')));
    assert.equal(record.event,'schema-upgrade-failed');assert.equal(record.phase,'checkouts');
    assert.deepEqual(record.command,{release,operation,status,signal,code});
   }else assert.match(failure.stderr,/schema upgrade command failed: pnpm \(arguments and output withheld\)/);
   assert.match(failure.stderr,/cleanup \{"containers":0,"volumes":0,"checkouts":0\}/);
   assert.doesNotMatch(failure.stderr+failure.stdout,/synthetic-private|upgrade-command-control-|--frozen-lockfile/);
   await assert.rejects(access(output),{code:'ENOENT'});
  }finally{await rm(scratch,{recursive:true,force:true});}
 });
}

// Plain command metadata skips inherited fields and accessor properties.
test('upgrade command metadata omits unknown labels and private exit values',()=>{
 const record=command=>upgradeFailure({upgradeCommand:command},'checkouts');
 for(const command of [{release:'private-release',operation:'clone'},{release:'old',operation:'private-operation'},null,'private-string'])assert.equal(record(command).command,undefined);
 assert.deepEqual(record({release:'new',operation:'install',status:256,signal:'private-signal',code:'private-code',secret:'private-value'}).command,{release:'new',operation:'install',status:null,signal:null,code:null});
 for(const status of [-1,3.5,NaN,Infinity,'73',null])assert.equal(record({release:'old',operation:'clone',status}).command.status,null);
 for(const status of [0,255])assert.equal(record({release:'old',operation:'clone',status}).command.status,status);
 for(const code of ['ENOENT','EACCES','ETIMEDOUT','ENOBUFS'])assert.equal(record({release:'old',operation:'clone',code}).command.code,code);
 for(const signal of ['SIGPRIVATE','toString','constructor',null,{}])assert.equal(record({release:'old',operation:'clone',signal}).command.signal,null);
 for(const signal of ['SIGTERM','SIGKILL','SIGINT','SIGABRT','SIGSEGV','SIGHUP','SIGQUIT'])assert.equal(record({release:'old',operation:'clone',signal}).command.signal,signal);
 const inherited=Object.create({upgradeCommand:{release:'old',operation:'clone'}});assert.equal(upgradeFailure(inherited,'checkouts').command,undefined);
 const getter=()=>{throw Error('private getter must not run');};
 assert.equal(upgradeFailure(Object.defineProperty({},'upgradeCommand',{get:getter}),'checkouts').command,undefined);
 assert.equal(record(Object.defineProperty({operation:'clone'},'release',{get:getter})).command,undefined);
 const facts=Object.defineProperties({release:'old',operation:'clone'},{status:{get:getter},signal:{get:getter},code:{get:getter}});
 assert.deepEqual(record(facts).command,{release:'old',operation:'clone',status:null,signal:null,code:null});
});

test('the v1 upgrade rehearsal refuses a pairing-v2 target before starting databases',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'upgrade-v2-boundary-')),output=join(scratch,'receipt.json'),calls=join(scratch,'docker-calls');
 try{
  const command=`#!${process.execPath}
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {basename,join} from 'node:path';
const name=basename(process.argv[1]),args=process.argv.slice(2);
if(name==='git'&&args[0]==='clone'){
 const root=args.at(-1);mkdirSync(join(root,'packages/registration/migrations'),{recursive:true});
 if(basename(root)==='new')writeFileSync(join(root,'packages/registration/migrations/064_cloud_pairing_v2.sql'),'-- synthetic cutover');
}
if(name==='docker'){appendFileSync(process.env.DOCKER_CALLS,JSON.stringify(args)+'\\n');process.exit(args[0]==='run'?73:0);}
`;
  for(const name of ['git','pnpm','docker'])await writeFile(join(scratch,name),command,{mode:0o700});
  const failure=await exec(process.execPath,['scripts/schema-upgrade-receipt.mjs',output],{cwd:root,env:{...process.env,PATH:scratch+':'+process.env.PATH,DOCKER_CALLS:calls},timeout:15000}).then(()=>assert.fail('v1 rehearsal accepted a v2 target'),error=>error);
  assert.match(failure.stderr,/schema upgrade v1 proof does not support pairing v2/);
  const {readFile}=await import('node:fs/promises');
  const attempted=await readFile(calls,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  assert.equal(attempted.split('\n').filter(Boolean).some(line=>JSON.parse(line)[0]==='run'),false);
  await assert.rejects(access(output),{code:'ENOENT'});
 }finally{await rm(scratch,{recursive:true,force:true});}
});
