import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const failure=code=>new Error('billing_display_guard.'+code);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const totals=output=>Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(kind=>{
 const matches=[...output.matchAll(new RegExp('^# '+kind+' (\\d+)$','gm'))];
 return [kind,matches.length===1?Number(matches[0][1]):-1];
}));
function green(result){
 const count=totals(result.output);
 return result.code===0&&count.tests===1&&count.pass===1&&count.fail===0&&count.cancelled===0&&count.skipped===0;
}
async function run(candidate,guard,inheritedEnv){
 const env={...inheritedEnv};delete env.NODE_TEST_CONTEXT;
 try{
  // A single owned process makes the deadline close the whole selected test execution.
  const result=await exec(process.execPath,['--test','--test-isolation=none','--test-reporter=tap','--test-name-pattern='+guard.pattern,guard.test],
   {cwd:candidate,env,timeout:guard.timeoutMs??15000,maxBuffer:2*1024*1024});
  return {code:0,output:result.stdout+result.stderr};
 }catch(error){
  if(error.killed)throw failure('timed_out');
  return {code:error.code,output:String(error.stdout??'')+String(error.stderr??'')};
 }
}
export async function qualifyGuard(candidate,guard,inheritedEnv=process.env){
 const path=join(candidate,guard.file),original=await readFile(path,'utf8');
 if(!guard.needle||original.split(guard.needle).length!==2)throw failure('mutation_target');
 const baseline=await run(candidate,guard,inheritedEnv);if(!green(baseline))throw failure('baseline_not_green');
 let omitted;
 try{await writeFile(path,original.replace(guard.needle,guard.replacement));omitted=await run(candidate,guard,inheritedEnv);}
 finally{await writeFile(path,original);}
 const restored=await run(candidate,guard,inheritedEnv);if(!green(restored))throw failure('restore_not_green');
 if(omitted.code===0)throw failure('omission_not_detected');
 const count=totals(omitted.output);
 if(omitted.code!==1||count.tests!==1||count.pass!==0||count.fail!==1||count.cancelled!==0||count.skipped!==0
  ||!new RegExp('^not ok \\d+ - '+escape(guard.pattern)+'$','m').test(omitted.output)
  ||!(/code: '?ERR_ASSERTION'?/.test(omitted.output)))throw failure('assertion_required');
 return {guard:guard.name,baseline:1,detected:1,restored:1};
}
const guards={
 pure:[
  {name:'remaining accepted success',file:'packages/registration/src/billing-display.ts',needle:"attempt.state==='succeeded'&&",replacement:'',test:'packages/registration/test/billing-display.test.ts',pattern:'billing display requires remaining accepted success'},
  {name:'exact hosted day gaps',file:'packages/registration/src/billing-display.ts',needle:'if(previous&&interval.from<=previous.until)',replacement:'if(previous)',test:'packages/registration/test/billing-display.test.ts',pattern:'billing display preserves exact hosted day holes'},
 ],
 database:[
  {name:'derived business scope after wait',file:'packages/registration/src/billing-display-machine.ts',needle:'||row.legal_business_id!==initial.legal_business_id',replacement:'',test:'packages/registration/test/billing-display-machine.test.ts',pattern:'billing display rechecks key and venue scope after waiting'},
  {name:'final revocation after wait',file:'packages/registration/src/billing-display-machine.ts',needle:"if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');",replacement:'',test:'packages/registration/test/billing-display-machine.test.ts',pattern:'billing display rechecks revocation after waiting'},
  {name:'trusted account destination',file:'packages/registration/src/billing-display-machine.ts',needle:'!accountOrigin(origin)||',replacement:'',test:'packages/registration/test/billing-display-machine.test.ts',pattern:'billing display refuses unsafe account origins'},
  {name:'billing writer exclusion',file:'packages/registration/src/billing-display-machine.ts',needle:"   if(!(await client.query('SELECT id FROM legal_businesses WHERE organisation_id=$1 AND id=$2 FOR SHARE',[initial.organisation_id,initial.legal_business_id])).rowCount)invalid();",replacement:'',test:'packages/registration/test/billing-display-machine.test.ts',pattern:'billing display reads of different venues share their business lock while billing writes wait'},
 ],
};
export async function qualifyDisplayGuards(mode){
 if(!Object.hasOwn(guards,mode))throw failure('invalid_mode');
 if(mode==='database'&&!process.env.TEST_DATABASE_URL)throw failure('database_required');
 const source=fileURLToPath(new URL('../',import.meta.url));
 const scratch=await mkdtemp(join(tmpdir(),'billing-display-guards-')),candidate=join(scratch,'candidate');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;if(mode==='pure')delete env.TEST_DATABASE_URL;
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',source,candidate],{env,timeout:10000});
  const {stdout:patch}=await exec('git',['diff','--binary','HEAD'],{cwd:source,env,maxBuffer:8*1024*1024});
  if(patch){
   const patchFile=join(scratch,'candidate.patch');await writeFile(patchFile,patch);
   await exec('git',['apply','--index','--binary',patchFile],{cwd:candidate,env});
  }
  const {stdout:untracked}=await exec('git',['ls-files','--others','--exclude-standard','-z'],{cwd:source,env});
  for(const file of untracked.split('\0').filter(Boolean)){
   await mkdir(dirname(join(candidate,file)),{recursive:true});
   await cp(join(source,file),join(candidate,file),{recursive:true,dereference:false});
  }
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,env,timeout:30000,maxBuffer:2*1024*1024});
  const results=[];
  for(const guard of guards[mode])results.push(await qualifyGuard(candidate,guard,env));
  return {mode,results};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--pure','--database'].includes(process.argv[2]))throw failure('invalid_mode');
  console.log(JSON.stringify(await qualifyDisplayGuards(process.argv[2].slice(2))));
 }catch(error){console.error(error.message.startsWith('billing_display_guard.')?error.message:'billing_display_guard.execution_failed');process.exitCode=1;}
}
