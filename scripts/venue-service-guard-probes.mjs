import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,cp} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const failure=code=>new Error('venue_service_guard.'+code);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function counts(output){
 return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(field=>{
  const matches=[...output.matchAll(new RegExp('^# '+field+' (\\d+)$','gm'))];
  return [field,matches.length===1?Number(matches[0][1]):-1];
 }));
}
async function run(candidate,guard,inheritedEnv){
 const env={...inheritedEnv};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 try{
  const result=await exec(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','--test-name-pattern=^'+escape(guard.pattern)+'$',guard.test],
   {cwd:candidate,env,timeout:guard.timeoutMs??25000,maxBuffer:4*1024*1024});
  return {code:0,output:result.stdout+result.stderr};
 }catch(error){
  if(error.killed)throw failure('timed_out');
  return {code:error.code,output:String(error.stdout??'')+String(error.stderr??'')};
 }
}
function exactResult(result,guard,failed){
 const value=counts(result.output);
 return result.code===(failed?1:0)&&value.tests===1&&value.pass===(failed?0:1)&&value.fail===(failed?1:0)
  &&value.cancelled===0&&value.skipped===0&&value.todo===0
  &&new RegExp('^'+(failed?'not ok':'ok')+' \\d+ - '+escape(guard.pattern)+'$','m').test(result.output);
}
export async function qualifyVenueGuard(candidate,guard,inheritedEnv=process.env){
 const path=join(candidate,guard.file),original=await readFile(path,'utf8');
 if(!guard.needle||original.split(guard.needle).length!==2)throw failure('mutation_target');
 const baseline=await run(candidate,guard,inheritedEnv);
 if(!exactResult(baseline,guard,false))throw failure('baseline_not_green');
 let omitted;
 try{
  await writeFile(path,original.replace(guard.needle,()=>guard.replacement));
  omitted=await run(candidate,guard,inheritedEnv);
 }finally{await writeFile(path,original);}
 const restored=await run(candidate,guard,inheritedEnv);
 if(!exactResult(restored,guard,false))throw failure('restore_not_green');
 if(omitted.code===0)throw failure('omission_not_detected');
 if(!exactResult(omitted,guard,true)||!(/code: '?ERR_ASSERTION'?/.test(omitted.output))
  ||!guard.expected||!omitted.output.includes(guard.expected))throw failure('assertion_required');
 return {guard:guard.name,baseline:1,detected:1,restored:1};
}

const guards={pure:[
 {name:'translation level floor',file:'packages/registration/src/venue-service-rules.ts',needle:"return level!=='registered'&&",replacement:'return ',test:'packages/registration/test/venue-service-rules.test.ts',pattern:'venue levels have exact service floors',expected:'false'},
 {name:'exclusive trial end',file:'packages/registration/src/venue-service-rules.ts',needle:'today<trial.endsOn){',replacement:'today<=trial.endsOn){',test:'packages/registration/test/venue-service-rules.test.ts',pattern:'trial dates grant only the stored half open interval',expected:"'connected'"},
],database:[]};

export async function qualifyVenueGuards(mode){
 if(!Object.hasOwn(guards,mode))throw failure('invalid_mode');
 if(mode==='database'&&!process.env.TEST_DATABASE_URL)throw failure('database_required');
 const root=fileURLToPath(new URL('../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-service-guards-')),candidate=join(scratch,'candidate');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 if(mode==='pure')delete env.TEST_DATABASE_URL;
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{env,timeout:10000});
  const {stdout:patch}=await exec('git',['diff','--binary','HEAD'],{cwd:root,env,maxBuffer:16*1024*1024});
  if(patch){
   const file=join(scratch,'candidate.patch');await writeFile(file,patch);
   await exec('git',['apply','--index','--binary',file],{cwd:candidate,env});
  }
  const {stdout:untracked}=await exec('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,env});
  for(const path of untracked.split('\0').filter(Boolean)){
   await mkdir(dirname(join(candidate,path)),{recursive:true});
   await cp(join(root,path),join(candidate,path),{recursive:true,dereference:false});
  }
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,env,timeout:30000,maxBuffer:4*1024*1024});
  if(!guards[mode].length)throw failure('empty_guard_set');
  const results=[];
  for(const guard of guards[mode])results.push(await qualifyVenueGuard(candidate,guard,env));
  return {mode,results};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--pure','--database'].includes(process.argv[2]))throw failure('invalid_mode');
  console.log(JSON.stringify(await qualifyVenueGuards(process.argv[2].slice(2))));
 }catch(error){
  console.error(/^venue_service_guard\.[a-z_]+$/.test(error.message)?error.message:'venue_service_guard.execution_failed');process.exitCode=1;
 }
}
