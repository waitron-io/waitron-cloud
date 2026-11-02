import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';

// The private database network isolates aliases and fixed fixture listeners from every foreign container.
test('candidate gateway and PostgreSQL qualify a clean bound traffic receipt',{timeout:240000},async t=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),tag='cloud-traffic-trial-'+randomUUID(),password=randomUUID();
 const run=(command:string,args:string[],timeout=30000)=>execFileSync(command,args,{cwd:root,timeout,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}).toString().trim();
 const docker=(args:string[],timeout=30000)=>run('docker',args,timeout);
 const candidate=()=>({cloudHead:run('git',['rev-parse','HEAD']),cloudTree:run('git',['rev-parse','HEAD^{tree}'])});
 assert.equal(run('git',['status','--porcelain']),'','the wrapper requires a clean candidate');const identity=candidate();
 const inventory=()=>docker(['ps','-aq','--no-trunc']).split('\n').filter(Boolean).sort().map(id=>docker(['inspect','--format','{{.Id}} {{.State.StartedAt}}',id]));
 const before=inventory();let image=false,database:string|undefined;
 const volumes:string[]=[],containers:string[]=[],suites:Record<string,string|number>[]=[];
 try{
  docker(['build','-f','deploy/local-remote/Dockerfile','-t',tag,'.'],150000);image=true;
  database=docker(['create','--name',tag+'-db','--network','none','--memory=256m','--cpus=1','--env',`POSTGRES_PASSWORD=${password}`,'--env','POSTGRES_DB=cloud_test','postgres:18-alpine']);
  assert.match(database,/^[a-f0-9]{64}$/);
  const mounts=JSON.parse(docker(['inspect','--format','{{json .Mounts}}',database])) as Array<{Type:string;Name?:string}>;
  volumes.push(...mounts.filter(m=>m.Type==='volume').map(m=>m.Name!));
  docker(['start',database]);
  const until=Date.now()+30000;
  for(;;)try{docker(['exec',database,'pg_isready','-U','postgres','-d','cloud_test']);break;}catch(error){if(Date.now()>=until)throw error;await delay(100);}
  const files={
   counters:['packages/remote-access/test/traffic-counters.test.ts'],
   collector:['packages/remote-access/test/traffic-exporter-store.test.ts','packages/remote-access/test/traffic-collector-store.test.ts'],
   gateway:['deploy/test-cloud/test-fixtures/allowance-traffic-proof.test.mjs','packages/remote-access/test/fixtures/traffic-rendered-haproxy.ts'],
  };
  for(const [id,paths]of Object.entries(files)){
   const container=docker(['create','--name',tag+'-'+id,'--network','container:'+database,'--cap-add','NET_ADMIN','--memory=512m','--cpus=1',
    '--mount',`type=bind,source=${root},target=/proof,readonly`,'--env',`TEST_DATABASE_URL=postgres://postgres:${password}@127.0.0.1:5432/cloud_test`,
    tag,'node','--test','--test-reporter=tap','--test-concurrency=1','--test-timeout=150000',...paths.map(path=>'/proof/'+path)]);
   assert.match(container,/^[a-f0-9]{64}$/);containers.push(container);
   const result=spawnSync('docker',['start','--attach',container],{cwd:root,timeout:180000,maxBuffer:8*1024*1024,encoding:'utf8'});
   const output=result.stdout+result.stderr;for(const line of output.split('\n'))t.diagnostic(id+': '+line);
   if(result.error)throw result.error;
   assert.equal(result.status,0,`${id}: actual traffic assertions must pass`);
   assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',container]),'0',output);
   const counts:Record<string,string|number>={id};
   for(const [field,label]of Object.entries({tests:'tests',passed:'pass',failed:'fail',cancelled:'cancelled',skipped:'skipped',todo:'todo'})){
    const matches=[...output.matchAll(new RegExp('^# '+label+' (\\d+)$','gm'))];assert.equal(matches.length,1,`${id}: exactly one ${label} summary is required`);
    const value=Number(matches[0]![1]);assert.ok(Number.isSafeInteger(value)&&value>=0);counts[field]=value;
   }
   assert.ok(Number(counts.tests)>0);assert.equal(counts.passed,counts.tests);
   for(const field of ['failed','cancelled','skipped','todo'])assert.equal(counts[field],0,`${id}: ${field} must be zero`);
   if(id==='gateway')assert.equal(counts.tests,4,'all three database scenarios and the rendered reload/crash scenario must run');
   suites.push(counts);docker(['rm','--force','--volumes',container]);
  }
 }finally{
  const present=new Set(docker(['ps','-aq','--no-trunc']).split('\n'));for(const container of containers)if(present.has(container))docker(['rm','--force','--volumes',container]);
  if(database)docker(['rm','--force','--volumes',database]);
  if(image)docker(['image','rm',tag]);
  assert.equal(docker(['ps','-aq','--filter','name=^/'+tag+'(-db|-counters|-collector|-gateway)?$']),'');
  assert.equal(docker(['image','ls','--quiet',tag]),'');
  const remaining=new Set(docker(['volume','ls','--quiet']).split('\n'));for(const volume of volumes)assert.equal(remaining.has(volume),false,'owned anonymous PostgreSQL volume must be removed');
  assert.deepEqual(inventory(),before,'foreign container identities and start times must survive the trial proof');
  t.diagnostic('owned gateway/database/image/volumes removed; foreign container identities and start times unchanged');
 }
 assert.equal(run('git',['status','--porcelain']),'');assert.deepEqual(candidate(),identity);
 const receipt={version:1,kind:'cloud-allowance-traffic',...identity,scope:'local-fixtures',productionEnforcement:'off',
  checks:{backendDeltasMatch:true,operationalDaysZero:true,userDaysThree:true,restartReplayStable:true,crashGapIncomplete:true,foreignScopeRefused:true},
  suites,cleanup:{containers:0,volumes:0,processes:0},
  limitations:['Controlled UTC accounting and database clocks, real fixture TLS and isolated PostgreSQL; no live calendar, provider, production route or payment qualification.','Empty authority between owned gateway lifetimes uses the country journal directly; active routes use the real transactional publisher.','Sampler restart, a request across midnight and reload exercise the rendered component; three-date database accounting and crash coverage execute separate scenarios.']};
 const {verifyAllowanceTrafficReceipt}=await import(new URL('../../../scripts/verify-allowance-traffic-receipt.mjs',import.meta.url).href);
 verifyAllowanceTrafficReceipt(receipt,identity);
 t.diagnostic('allowance-traffic-receipt '+JSON.stringify(receipt));
});
