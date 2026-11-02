import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,cp} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const failure=code=>new Error('allowance_traffic_guard.'+code);
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function counts(output){
 return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(field=>{
  const matches=[...output.matchAll(new RegExp('^# '+field+' (\\d+)$','gm'))];
  return [field,matches.length===1?Number(matches[0][1]):-1];
 }));
}
async function run(candidate,guard,inheritedEnv,runtime={}){
 const env={...inheritedEnv};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 let container;
 try{
  if(runtime.createPrefix){
   container=(await exec('docker',runtime.createPrefix,{cwd:candidate,env,timeout:10000})).stdout.trim();
   if(!/^[a-f0-9]{64}$/.test(container))throw failure('gateway_container');
  }
  const command=container?'docker':runtime.command??process.execPath;
  const args=container?['start','--attach',container]:[...(runtime.prefix??[]),'--test','--test-isolation=none','--test-reporter=tap','--test-name-pattern=^'+escape(guard.pattern)+'$',guard.test];
  const result=await exec(command,args,
   {cwd:candidate,env,timeout:guard.timeoutMs??25000,maxBuffer:4*1024*1024});
  return {code:0,output:result.stdout+result.stderr};
 }catch(error){
  if(error.killed)throw failure('timed_out');
  return {code:error.code,output:String(error.stdout??'')+String(error.stderr??'')};
 }finally{if(container)await exec('docker',['rm','--force','--volumes',container],{env,timeout:10000});}
}
function exactResult(result,guard,failed){
 const value=counts(result.output);
 return result.code===(failed?1:0)&&value.tests===1&&value.pass===(failed?0:1)&&value.fail===(failed?1:0)
  &&value.cancelled===0&&value.skipped===0&&value.todo===0
  &&new RegExp('^'+(failed?'not ok':'ok')+' \\d+ - '+escape(guard.pattern)+'$','m').test(result.output);
}
export async function qualifyAllowanceGuard(candidate,guard,inheritedEnv=process.env,runtime){
 const path=join(candidate,guard.file),original=await readFile(path,'utf8');
 if(!guard.needle||original.split(guard.needle).length!==2)throw failure('mutation_target');
 const baseline=await run(candidate,guard,inheritedEnv,runtime);
 if(!exactResult(baseline,guard,false))throw failure('baseline_not_green');
 let omitted;
 try{
  await writeFile(path,original.replace(guard.needle,()=>guard.replacement));
  omitted=await run(candidate,guard,inheritedEnv,runtime);
 }finally{await writeFile(path,original);}
 const restored=await run(candidate,guard,inheritedEnv,runtime);
 if(!exactResult(restored,guard,false))throw failure('restore_not_green');
 if(omitted.code===0)throw failure('omission_not_detected');
 if(!exactResult(omitted,guard,true)||!(/code: '?ERR_ASSERTION'?/.test(omitted.output))
  ||!guard.expected||!omitted.output.includes(guard.expected))throw failure('assertion_required');
 return {guard:guard.name,baseline:1,detected:1,restored:1};
}

const guards={pure:[
 {name:'active trial interval',file:'packages/registration/src/billing-allowance-rules.ts',needle:"t.state==='active'&&start<=day&&day<end",replacement:"t.state==='active'",test:'packages/registration/test/billing-allowance-rules.test.ts',pattern:'trial grants include their start and exclude their end',expected:'2n !== 0n'},
 {name:'payment method trial tier',file:'packages/registration/src/billing-allowance-rules.ts',needle:'trialAllowanceTier(i.hasPaymentMethod)',replacement:'trialAllowanceTier(false)',test:'packages/registration/test/billing-allowance-rules.test.ts',pattern:'a current payment method selects the full trial allowance',expected:'2n !== 6n'},
],database:[
 {name:'account bucket serialization',file:'packages/registration/src/billing-allowances.ts',needle:"  await lock(client,'allowance-account:'+input.accountId+':'+input.service+':'+month);",replacement:'',test:'packages/registration/test/billing-allowances.test.ts',pattern:'one account last unit is atomic across venues',expected:'3n'},
 {name:'composite account ownership',file:'packages/registration/src/billing-allowances.ts',needle:" if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[input.accountId,args[0]])).rowCount)fail('allowance_scope_not_found');",replacement:'',test:'packages/registration/test/billing-allowances.test.ts',pattern:'foreign owners crossed installations and lost current ownership refuse without writes',expected:'Missing expected rejection'},
 {name:'original reservation replay',file:'packages/registration/src/billing-allowances.ts',needle:'saved.binding!==input.binding',replacement:'false',test:'packages/registration/test/billing-allowances.test.ts',pattern:'reservation replay retains its original receipt and refuses changed immutable binding',expected:'Missing expected rejection'},
 {name:'never attempted release',file:'packages/registration/migrations/048_billing_allowances_traffic.sql',needle:"(NEW.state IN ('held','spent','released') AND NOT (OLD.state=NEW.state OR (OLD.state='held' AND NEW.state IN ('spent','released'))))",replacement:'false',test:'packages/registration/test/billing-allowances.test.ts',pattern:'persisted spent translation units cannot be refunded by a state update',expected:'0n !== 2n'},
 {name:'independent money cap',file:'packages/translation/src/job-store.ts',needle:" if(total*perItem>left){const fits=left<=0n?0n:left/perItem;fail('limit_reached',Number(fits<total?fits:total));}",replacement:'',test:'packages/translation/test/billing-allowance-translation.test.ts',pattern:'translation allowance and the original exact-fit money cap remain independent',expected:'Missing expected rejection'},
 {name:'current job lease',file:'packages/translation/src/worker.ts',needle:"SELECT id FROM translation_jobs WHERE id=$1 AND lease_id=$2 AND state='running' AND lease_until>clock_timestamp() FOR SHARE",replacement:"SELECT id FROM translation_jobs WHERE id=$1 AND $2::uuid IS NOT NULL AND state='running' AND lease_until>clock_timestamp() FOR SHARE",test:'packages/translation/test/billing-allowance-worker.test.ts',pattern:'a takeover after allowance spending prevents the actual provider call',expected:'1 !== 0'},
 {name:'traffic signature',file:'packages/remote-access/src/traffic-report.ts',needle:"!verify(null,Buffer.from(e.payload,'base64url'),key,Buffer.from(e.signature,'base64url'))",replacement:'false',test:'packages/remote-access/test/traffic-store.test.ts',pattern:'forged unbound crossed stale and non-test traffic adds no bytes',expected:'Missing expected rejection'},
 {name:'final reporter binding',file:'packages/remote-access/src/traffic-store.ts',needle:'||Number(reporter.generation)!==report.generation',replacement:'',test:'packages/remote-access/test/traffic-store.test.ts',pattern:'a new old-generation report refuses even while its public key remains available',expected:'Missing expected rejection'},
 {name:'traffic sequence replay',file:'packages/remote-access/src/traffic-store.ts',needle:"if(saved.report_payload!==envelope.payload||saved.report_signature!==envelope.signature)fail('traffic_report_conflict');",replacement:'',test:'packages/remote-access/test/traffic-store.test.ts',pattern:'traffic atomic replay and scope survive reconnect',expected:'Missing expected rejection'},
 {name:'operational backend exclusion',file:'packages/remote-access/src/traffic-counters.ts',needle:"const row=line.split(','),route=backends.get(row[px]??'');if(route===undefined||row[sv]!=='BACKEND')continue;",replacement:"const row=line.split(','),name=row[px]??'';if(name.startsWith('traffic_user_'))continue;const route=backends.get(name.replace('traffic_ops_','traffic_user_'));if(route===undefined||row[sv]!=='BACKEND')continue;",test:'deploy/test-cloud/test-fixtures/allowance-traffic-proof.test.mjs',pattern:'real rendered gateway and PostgreSQL prove zero operational dates in the exact stored trial',expected:'probes must add no traffic ledger events',gateway:true,timeoutMs:45000},
 {name:'counter decrease overflow',file:'packages/remote-access/src/traffic-counters.ts',needle:'if(ingress<0n||egress<0n||ingress+egress>9223372036854775807n)return invalid();',replacement:'',test:'packages/remote-access/test/traffic-counters.test.ts',pattern:'traffic decreases wraps and signed bigint overflow refuse fabricated deltas',expected:'Missing expected exception'},
 {name:'complete trial coverage',file:'packages/registration/src/billing-trial-usage.ts',needle:'complete:traffic.complete&&runs.uncertain===0',replacement:'complete:runs.uncertain===0',test:'packages/registration/test/billing-trial-usage.test.ts',pattern:'trial usage requires complete traffic evidence before zero use is known',expected:'strictly deep-equal'},
 {name:'confirmed attempt distinction',file:'packages/registration/src/billing-trial-usage.ts',needle:'complete:traffic.complete&&runs.uncertain===0',replacement:'complete:traffic.complete',test:'packages/registration/test/billing-trial-usage.test.ts',pattern:'spent unconfirmed service admission stays incomplete and is never a confirmed trial run',expected:'strictly deep-equal'},
 {name:'exact consent actor',file:'packages/translation/src/consent.ts',needle:'WHERE id=$1 AND account_id=$2 AND venue_id=$3 AND organisation_id=$4',replacement:'WHERE id=$1 AND $2::uuid IS NOT NULL AND venue_id=$3 AND organisation_id=$4',test:'packages/translation/test/billing-allowance-consent.test.ts',pattern:'allowance consent rechecks the captured row actor after a consent wait',expected:'Missing expected rejection'},
]};

async function qualifyGatewayGuard(candidate,guard,env){
 const tag='cloud-allowance-guard-'+randomUUID(),password=randomUUID();let database,image=false;
 const docker=async args=>(await exec('docker',args,{cwd:candidate,env,timeout:120000,maxBuffer:4*1024*1024})).stdout.trim();
 try{
  await docker(['build','--file','deploy/local-remote/Dockerfile','--tag',tag,'.']);image=true;
  database=await docker(['create','--network','none','--memory=256m','--cpus=1','--env','POSTGRES_PASSWORD='+password,'--env','POSTGRES_DB=cloud_test','postgres:18-alpine']);
  if(!/^[a-f0-9]{64}$/.test(database))throw failure('gateway_database');
  await docker(['start',database]);const until=Date.now()+30000;
  for(;;)try{await docker(['exec',database,'pg_isready','-U','postgres','-d','cloud_test']);break;}catch(error){if(Date.now()>=until)throw error;await delay(100);}
  const args=['--test','--test-isolation=none','--test-reporter=tap','--test-name-pattern=^'+escape(guard.pattern)+'$',guard.test];
  return await qualifyAllowanceGuard(candidate,guard,env,{createPrefix:['create','--network','container:'+database,'--cap-add','NET_ADMIN','--memory=512m','--cpus=1',
   '--mount',`type=bind,source=${candidate},target=${candidate},readonly`,'--workdir',candidate,
   '--env',`TEST_DATABASE_URL=postgres://postgres:${password}@127.0.0.1:5432/cloud_test`,tag,'node',...args]});
 }finally{
  if(database)await docker(['rm','--force','--volumes',database]);
  if(image)await docker(['image','rm',tag]);
 }
}

export async function qualifyAllowanceGuards(mode){
 if(!Object.hasOwn(guards,mode))throw failure('invalid_mode');
 if(mode==='database'&&!process.env.TEST_DATABASE_URL)throw failure('database_required');
 const root=fileURLToPath(new URL('../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'allowance-traffic-guards-')),candidate=join(scratch,'candidate');
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_OPTIONS;
 if(mode==='pure')delete env.TEST_DATABASE_URL;
 try{
  await exec('git',['clone','--quiet','--shared',root,candidate],{env,timeout:10000});
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
  for(const guard of guards[mode]){
   process.stderr.write('Allowance guard: '+guard.name+'\n');
   results.push(guard.gateway?await qualifyGatewayGuard(candidate,guard,env):await qualifyAllowanceGuard(candidate,guard,env));
  }
  return {mode,results};
 }finally{await rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--pure','--database'].includes(process.argv[2]))throw failure('invalid_mode');
  console.log(JSON.stringify(await qualifyAllowanceGuards(process.argv[2].slice(2))));
 }catch(error){
  console.error(/^allowance_traffic_guard\.[a-z_]+$/.test(error.message)?error.message:'allowance_traffic_guard.execution_failed');process.exitCode=1;
 }
}
