import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,chmod,symlink,rm,mkdir,realpath,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectForwardReport,ForwardReportPoller} from '../src/forward-report-collector.ts';
import {signForwardReport} from '../src/forward-report.ts';

async function fixture(){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'forward-collector-'))),file=join(directory,'report.json');
 const mapping={country:'ES' as const,environment:'test' as const,cellId:randomUUID(),file,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const now=Date.now(),key=generateKeyPairSync('ed25519');
 const envelope=signForwardReport({version:1,audience:'waitron-cloud-public-forward-report',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,sequence:1,issuedAt:now,observations:[]},key.privateKey);
 await chmod(directory,0o2750);await writeFile(file,JSON.stringify(envelope),{mode:0o640});await chmod(file,0o640);
 return {directory,mapping,envelope,async close(){await rm(directory,{recursive:true,force:true});}};
}

test('collector passes only a bounded envelope from the exact regular private file to authenticated storage',async()=>{
 const f=await fixture();try{
  const seen:unknown[]=[];const store={async record(mapping:unknown,envelope:unknown){seen.push([mapping,envelope]);return 'accepted' as const;},async prune(){return 0;}};
  await collectForwardReport(f.mapping,store);assert.deepEqual(seen,[[f.mapping,f.envelope]]);
 }finally{await f.close();}
});
for(const fault of ['mode','uid','gid','oversize','symlink','parent-symlink','directory','malformed','traversal'] as const)test(`collector refuses ${fault} before storage`,async()=>{
 const f=await fixture();try{
  let touched=false;const store={async record(){touched=true;return 'accepted' as const;},async prune(){return 0;}};
  let mapping={...f.mapping};
  if(fault==='mode')await chmod(mapping.file,0o644);
  if(fault==='uid')mapping.writerUid++;
  if(fault==='gid')mapping.readerGid++;
  if(fault==='oversize')await writeFile(mapping.file,JSON.stringify(f.envelope)+' '.repeat(262145));
  if(fault==='symlink'){await symlink(mapping.file,join(f.directory,'link'));mapping.file=join(f.directory,'link');}
  if(fault==='parent-symlink'){await symlink(f.directory,join(f.directory,'alias'));mapping.file=join(f.directory,'alias','report.json');}
  if(fault==='directory'){await mkdir(join(f.directory,'sub'));mapping.file=join(f.directory,'sub');}
  if(fault==='malformed')await writeFile(mapping.file,'private-canary');
  if(fault==='traversal')mapping.file=f.directory+'/../'+f.directory.split('/').at(-1)+'/report.json';
  await assert.rejects(collectForwardReport(mapping,store),/^Error: forward_report_unavailable$/);assert.equal(touched,false);
 }finally{await f.close();}
});
test('poller serializes each cell, respects 30-second polls and 60-second pruning, and logs fixed errors',async()=>{
 const f=await fixture();try{
  let finish!:()=>void,reads=0,prunes=0;const logs:string[]=[];
  const store={async record(){reads++;if(reads===1)await new Promise<void>(resolve=>{finish=resolve;});throw new Error('private-canary');},async prune(){prunes++;return 0;}};
  const poller=new ForwardReportPoller([f.mapping],store,message=>logs.push(message));
  const pending=poller.poll(0);for(let i=0;!finish&&i<1000;i++)await new Promise(resolve=>setTimeout(resolve,1));assert(finish,'first read reached storage');
  await poller.poll(30000);assert.equal(reads,1);assert.equal(prunes,1);finish();await pending;
  await poller.poll(29999);assert.equal(reads,1);
  await poller.poll(30000);assert.equal(reads,2);assert.equal(prunes,1);
  await poller.poll(60000);assert.equal(reads,3);assert.equal(prunes,2);
  assert.deepEqual(logs,['remote.forward_collection_failed','remote.forward_collection_failed','remote.forward_collection_failed']);
 }finally{await f.close();}
});
test('collector CLI rejects untrusted configuration without exposing its contents',async()=>{
 const f=await fixture();try{
  const path=fileURLToPath(new URL('../src/forward-report-cli.ts',import.meta.url));
  for(const config of [{mappings:[{...f.mapping,country:'FR'}]}, {mappings:[f.mapping,f.mapping]}, {mappings:[f.mapping],secret:'private-canary'}]){
   const file=join(f.directory,'config.json');await writeFile(file,JSON.stringify(config));
   const result=spawnSync(process.execPath,[path,file,'--once'],{encoding:'utf8',timeout:5000,env:{...process.env,DATABASE_URL:'postgres://invalid/private-canary'}});
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'remote.forward_collector_failed\n');
  }
 }finally{await f.close();}
});

test('collector CLI once fails when the configured country database is unavailable',async()=>{
 const f=await fixture();try{
  const path=fileURLToPath(new URL('../src/forward-report-cli.ts',import.meta.url)),config=join(f.directory,'config.json');
  await writeFile(config,JSON.stringify({mappings:[f.mapping]}));
  const result=spawnSync(process.execPath,[path,config,'--once'],{encoding:'utf8',timeout:10000,env:{...process.env,DATABASE_URL:'postgres://probe@127.0.0.1:1/private-canary'}});
  assert.equal(result.signal,null);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'remote.forward_collection_failed\n');
 }finally{await f.close();}
});

test('failed pruning makes the poll fail before ingestion while a later poll recovers',async()=>{
 const f=await fixture();try{
  let reads=0,prunes=0;const logs:string[]=[];
  const poller=new ForwardReportPoller([f.mapping],{async record(){reads++;return 'accepted';},async prune(){if(++prunes===1)throw Error('private-canary');return 0;}},message=>logs.push(message));
  assert.equal(await poller.poll(0),false);assert.equal(reads,0);assert.deepEqual(logs,['remote.forward_collection_failed']);
  assert.equal(await poller.poll(60000),true);assert.equal(reads,1);assert.equal(prunes,2);
 }finally{await f.close();}
});
test('collector CLI once with no configured cells succeeds without connecting',async()=>{
 const f=await fixture();try{
  const path=fileURLToPath(new URL('../src/forward-report-cli.ts',import.meta.url)),config=join(f.directory,'config.json');await writeFile(config,JSON.stringify({mappings:[]}));
  const result=spawnSync(process.execPath,[path,config,'--once'],{encoding:'utf8',timeout:10000,env:{...process.env,DATABASE_URL:'postgres://probe@127.0.0.1:1/private-canary'}});
  assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 }finally{await f.close();}
});

for(const fault of ['hard-link','directory-mode'] as const)test(`collector refuses ${fault} before storage`,async()=>{
 const f=await fixture();try{
  if(fault==='hard-link')await link(f.mapping.file,join(f.directory,'second.json'));else await chmod(f.directory,0o750);
  let calls=0;await assert.rejects(collectForwardReport(f.mapping,{async record(){calls++;return 'accepted';},async prune(){return 0;}}),/^Error: forward_report_unavailable$/);assert.equal(calls,0);
 }finally{await f.close();}
});
for(const scenario of ['directory-open','post-read','fifo'] as const)test(`collector refuses ${scenario} race without hanging or reaching storage`,async()=>{
 const f=await fixture();try{
  if(scenario==='fifo'){await rm(f.mapping.file);execFileSync('mkfifo',['-m','640',f.mapping.file]);}
  const path=fileURLToPath(new URL('./fixtures/forward-file-race.ts',import.meta.url));
  const result=spawnSync(process.execPath,[path,scenario,JSON.stringify(f.mapping)],{encoding:'utf8',timeout:3000});
  assert.equal(result.signal,null,'nonregular input must not block the collector');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stdout,'refused without storage\n');
 }finally{await f.close();}
});
