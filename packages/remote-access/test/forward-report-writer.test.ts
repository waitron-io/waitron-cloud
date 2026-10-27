import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,randomUUID,createPublicKey} from 'node:crypto';
import {mkdtemp,mkdir,chmod,readFile,readdir,rm,stat,writeFile,symlink,unlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyForwardReport,type ForwardBinding} from '../src/forward-report.ts';
const module=await import('../src/forward-report-writer.ts').catch(()=>undefined);
const start=1_000_000;
async function fixture(){
 assert.equal(typeof module?.ForwardReportWriter,'function','bounded report writer must exist');
 const directory=await realpath(await mkdtemp(join(tmpdir(),'cloud-forward-writer-')));await chmod(directory,0o2750);
 const keys=generateKeyPairSync('ed25519'),cellId=randomUUID(),gatewayId=randomUUID();let now=start;
 const options={directory,key:keys.privateKey,cellId,gatewayId,generation:1,readerGid:process.getegid!(),now:()=>now};
 const writer=new module!.ForwardReportWriter(options);await writer.restore(now);
 const binding:ForwardBinding={cellId,gatewayId,generation:1,installationId:randomUUID(),venueId:randomUUID(),revision:7,routeId:'public_availability',routeBinding:'a'.repeat(64),manifestSequence:3,manifestExpiresAt:start+600000};
 return {writer,options,binding,keys,directory,setTime:(value:number)=>{now=value;},time:()=>now,
  async report(){return verifyForwardReport(JSON.parse(await readFile(join(directory,'report.json'),'utf8')),keys.publicKey,now);},
  close:()=>rm(directory,{recursive:true,force:true})};
}
test('new_success_beats_old_failure and one completion per attempt',async()=>{
 const f=await fixture();try{
  const older=f.writer.begin(f.binding,start),newer=f.writer.begin(f.binding,start);
  newer(null,start+2);older('upstream_transport',start+3);newer('upstream_non_200',start+4);
  f.setTime(start+5);await f.writer.flush(f.time());const report=await f.report();
  assert.equal(report.sequence,1);assert.equal(report.observations.length,1);
  assert.equal(report.observations[0]!.category,null);assert.equal(report.observations[0]!.observedAt,start+2);
 }finally{await f.close();}
});
test('changed_binding_discards_inflight and only fixed fields reach the report',async()=>{
 const f=await fixture();try{
  const old=f.writer.begin(f.binding,start);
  const complete=f.writer.begin({...f.binding,revision:8,routeBinding:'b'.repeat(64),raw:'secret body'} as ForwardBinding,start);
  complete('upstream_non_200',start);old('upstream_transport',start);await f.writer.flush(start);
  const report=await f.report();assert.equal(report.observations[0]!.revision,8);assert.equal(report.observations[0]!.routeBinding,'b'.repeat(64));
  assert.equal(report.observations[0]!.category,'upstream_non_200');assert.doesNotMatch(Buffer.from(JSON.parse(await readFile(join(f.directory,'report.json'),'utf8')).payload,'base64url').toString(),/secret|raw|address|hostname|error/i);
 }finally{await f.close();}
});
test('restart_preserves_sequence_not_freshness and publication spacing',async()=>{
 const f=await fixture();try{
  f.writer.begin(f.binding,start)('upstream_timeout',start);await f.writer.flush(start);
  f.setTime(start+10000);const restarted=new module!.ForwardReportWriter(f.options);await restarted.restore(f.time());
  restarted.begin(f.binding,f.time())(null,f.time());await restarted.flush(f.time());assert.equal((await f.report()).sequence,1);
  f.setTime(start+30000);await restarted.flush(f.time());let report=await f.report();assert.equal(report.sequence,2);assert.equal(report.observations[0]!.observedAt,start+10000);
  f.setTime(start+60000);await restarted.flush(f.time());assert.equal((await f.report()).sequence,2,'unchanged evidence does not publish a heartbeat');
  f.setTime(start+310000);const expired=new module!.ForwardReportWriter(f.options);await expired.restore(f.time());await expired.flush(f.time());
  report=await f.report();assert.equal(report.sequence,3);assert.deepEqual(report.observations,[]);
  expired.begin(f.binding,f.time())(null,f.time());f.setTime(start+340000);await expired.flush(f.time());report=await f.report();assert.equal(report.sequence,4);assert.equal(report.observations[0]!.observationSequence,4);
 }finally{await f.close();}
});
test('unchanged entries keep their observation sequence and original expiry',async()=>{
 const f=await fixture();try{
  f.writer.begin(f.binding,start)('upstream_transport',start);await f.writer.flush(start);
  const other={...f.binding,installationId:randomUUID(),venueId:randomUUID()};f.setTime(start+30000);f.writer.begin(other,f.time())(null,f.time());await f.writer.flush(f.time());
  const report=await f.report();assert.equal(report.sequence,2);const original=report.observations.find(o=>o.installationId===f.binding.installationId)!;
  assert.equal(original.observationSequence,1);assert.equal(original.observedAt,start);assert.equal(original.expiresAt,start+300000);
 }finally{await f.close();}
});
for(const damage of ['missing','corrupt','bad-signature','marker'])test(`missing_state_requires_new_generation: ${damage}`,async()=>{
 const f=await fixture();try{
  f.writer.begin(f.binding,start)(null,start);await f.writer.flush(start);
  if(damage==='missing')await unlink(join(f.directory,'report.json'));
  if(damage==='corrupt')await writeFile(join(f.directory,'report.json'),'broken');
  if(damage==='bad-signature'){const report=JSON.parse(await readFile(join(f.directory,'report.json'),'utf8'));report.signature='a'.repeat(86);await writeFile(join(f.directory,'report.json'),JSON.stringify(report));}
  if(damage==='marker')await unlink(join(f.directory,'initialized.json'));
  const restarted=new module!.ForwardReportWriter(f.options);await assert.rejects(restarted.restore(start),/forward_report_unavailable/);
  restarted.begin(f.binding,start)(null,start);await restarted.flush(start+30000);
  if(damage!=='marker'){
   const rotated=new module!.ForwardReportWriter({...f.options,generation:2,key:generateKeyPairSync('ed25519').privateKey});await rotated.restore(start);
   rotated.begin({...f.binding,generation:2},start)(null,start);await rotated.flush(start);assert.equal(JSON.parse(Buffer.from(JSON.parse(await readFile(join(f.directory,'report.json'),'utf8')).payload,'base64url').toString()).generation,2);
  }
 }finally{await f.close();}
});
test('sixty_four_routes_two_writes_per_minute with serialized flush and bounded files',async()=>{
 const f=await fixture();try{
  for(let i=0;i<65;i++)f.writer.begin({...f.binding,installationId:randomUUID(),venueId:randomUUID()},start)(null,start);
  await Promise.all([f.writer.flush(start),f.writer.flush(start)]);let report=await f.report();assert.equal(report.observations.length,64);assert.equal(report.sequence,1);
  const binding=report.observations[0]!;
  f.setTime(start+1000);f.writer.begin(binding,f.time())('upstream_timeout',f.time());
  f.setTime(start+29999);await f.writer.flush(f.time());assert.equal((await f.report()).sequence,1);
  f.setTime(start+30000);await f.writer.flush(f.time());assert.equal((await f.report()).sequence,2);
  f.setTime(start+31000);f.writer.begin(binding,f.time())(null,f.time());
  f.setTime(start+59999);await f.writer.flush(f.time());assert.equal((await f.report()).sequence,2);
  f.setTime(start+60000);await f.writer.flush(f.time());assert.equal((await f.report()).sequence,3);
  f.setTime(start+331000);await f.writer.flush(f.time());report=await f.report();assert.equal(report.sequence,4);assert.deepEqual(report.observations,[]);
  assert.deepEqual((await readdir(f.directory)).sort(),['initialized.json','report.json']);assert.ok((await stat(join(f.directory,'report.json'))).size<=262144);
  assert.equal((await stat(join(f.directory,'report.json'))).mode&0o7777,0o640);
  assert.equal((await stat(join(f.directory,'report.json'))).gid,process.getegid!());
 }finally{await f.close();}
});
test('expiry and stream identity reject observations without refreshing authority',async()=>{
 const f=await fixture();try{
  for(const patch of [{cellId:randomUUID()},{gatewayId:randomUUID()},{generation:2},{manifestExpiresAt:start}])f.writer.begin({...f.binding,...patch},start)('upstream_transport',start);
  const complete=f.writer.begin(f.binding,start);f.setTime(start+600000);complete('upstream_transport',f.time());await f.writer.flush(f.time());
  assert.equal((await readdir(f.directory)).includes('report.json'),false);
 }finally{await f.close();}
});
for(const mode of [0o750,0o2770,0o2755])test(`directory permissions fail closed: ${mode.toString(8)}`,async()=>{
 const f=await fixture();try{await chmod(f.directory,mode);const writer=new module!.ForwardReportWriter(f.options);await assert.rejects(writer.restore(start),/forward_report_unavailable/);}finally{await f.close();}
});
test('symlink report and directory are refused without changing the target',async()=>{
 const f=await fixture();const other=await mkdtemp(join(tmpdir(),'cloud-forward-target-'));try{
  await writeFile(join(other,'private'),'untouched');await symlink(join(other,'private'),join(f.directory,'report.json'));
  const writer=new module!.ForwardReportWriter(f.options);await assert.rejects(writer.restore(start),/forward_report_unavailable/);assert.equal(await readFile(join(other,'private'),'utf8'),'untouched');
  await symlink(f.directory,join(other,'linked'));const linked=new module!.ForwardReportWriter({...f.options,directory:join(other,'linked')});await assert.rejects(linked.restore(start),/forward_report_unavailable/);
 }finally{await f.close();await rm(other,{recursive:true,force:true});}
});
test('disk or public-only key disables diagnostics and flush contains failures',async()=>{
 const f=await fixture();try{
  assert.throws(()=>new module!.ForwardReportWriter({...f.options,key:createPublicKey(f.keys.privateKey)}),/forward_report_unavailable/);
  f.writer.begin(f.binding,start)('upstream_transport',start);await mkdir(join(f.directory,'report.json.tmp'));
  await f.writer.flush(start);assert.equal((await readdir(f.directory)).includes('report.json'),false);
  await rm(join(f.directory,'report.json.tmp'),{recursive:true});await f.writer.flush(start+30000);assert.equal((await readdir(f.directory)).includes('report.json'),false,'failed writer stays disabled');
 }finally{await f.close();}
});
test('restart removes only an owned incomplete temporary report',async()=>{
 const f=await fixture();try{
  f.writer.begin(f.binding,start)(null,start);await f.writer.flush(start);
  await writeFile(join(f.directory,'report.json.tmp'),'incomplete',{mode:0o640});
  f.setTime(start+30000);const restarted=new module!.ForwardReportWriter(f.options);await restarted.restore(f.time());
  restarted.begin(f.binding,f.time())('upstream_transport',f.time());await restarted.flush(f.time());
  const report=await f.report();assert.equal(report.sequence,2);assert.equal(report.observations[0]!.category,'upstream_transport');
  assert.equal((await readdir(f.directory)).includes('report.json.tmp'),false);
 }finally{await f.close();}
});
test('wrong reader group, regressed generation and reused generation key are refused',async()=>{
 const f=await fixture();try{
  const wrong=new module!.ForwardReportWriter({...f.options,readerGid:f.options.readerGid+1});await assert.rejects(wrong.restore(start),/forward_report_unavailable/);
  f.writer.begin(f.binding,start)(null,start);await f.writer.flush(start);
  for(const options of [{...f.options,key:generateKeyPairSync('ed25519').privateKey},{...f.options,generation:2}]){
   const writer=new module!.ForwardReportWriter(options);await assert.rejects(writer.restore(start),/forward_report_unavailable/);
  }
  const rotated=new module!.ForwardReportWriter({...f.options,generation:2,key:generateKeyPairSync('ed25519').privateKey});await rotated.restore(start);
  const older=new module!.ForwardReportWriter(f.options);await assert.rejects(older.restore(start),/forward_report_unavailable/);
 }finally{await f.close();}
});
test('a completion during publication remains pending for the next snapshot',async()=>{
 const f=await fixture();try{
  f.writer.begin(f.binding,start)('upstream_transport',start);
  const publishing=f.writer.flush(start);
  f.writer.begin(f.binding,start)(null,start+1);await publishing;
  assert.equal((await f.report()).observations[0]!.category,'upstream_transport');
  f.setTime(start+30000);await f.writer.flush(f.time());const report=await f.report();
  assert.equal(report.sequence,2);assert.equal(report.observations[0]!.category,null);assert.equal(report.observations[0]!.observedAt,start+1);
 }finally{await f.close();}
});
