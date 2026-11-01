import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
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
