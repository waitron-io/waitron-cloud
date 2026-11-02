import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {chmod,link,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {basename,dirname,join} from 'node:path';
import {test} from 'node:test';
import {signTrafficReport,type TrafficReport} from '../src/traffic-report.ts';
import type {TrafficMapping} from '../src/traffic-coverage.ts';

const api=await import(new URL('../src/traffic-collector.ts',import.meta.url).href).catch(()=>({}));
function collector(){assert.equal(typeof api.collectTraffic,'function','private collector must retain reports until durable acknowledgement');return api.collectTraffic;}
const keys=generateKeyPairSync('ed25519');
async function fixture(t:{after:(fn:()=>Promise<void>)=>void}){
 const directory=await realpath(await mkdtemp(join(tmpdir(),'traffic-collector-')));t.after(()=>rm(directory,{recursive:true,force:true}));await chmod(directory,0o2750);
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId:randomUUID(),directory,writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const report:TrafficReport={version:1,audience:'waitron-cloud-remote-traffic',cellId:mapping.cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),sequence:1,
  from:'2026-11-01T00:00:00.000Z',until:'2026-11-01T00:00:01.000Z',complete:true,entries:[]};
 async function put(value=report,name=`${value.processId}.${value.sequence}.json`){const file=join(directory,name),envelope=signTrafficReport(value,keys.privateKey),text=JSON.stringify(envelope);
  await writeFile(file,text,{mode:0o640});await chmod(file,0o640);return {file,envelope,text};}
 const original=await put();return {mapping,report,put,...original};
}
const receipt=(r:TrafficReport,state:'accepted'|'replay'='accepted')=>({state,processId:r.processId,sequence:r.sequence});
const refused=/^Error: traffic_collection_unavailable$/;

// An early unlink loses the only retry after a refused or lost country-database reply.
test('collector keeps exact bytes until storage commits then removes only the matching report',async t=>{
 const f=await fixture(t),collect=collector();let release!:()=>void;
 const pending=collect(f.mapping,{async record(mapping:TrafficMapping,envelope:unknown){assert.deepEqual(mapping,f.mapping);assert.deepEqual(envelope,f.envelope);await new Promise<void>(r=>{release=r;});return receipt(f.report);}});
 for(let n=0;!release&&n<1000;n++)await new Promise(r=>setTimeout(r,1));assert.ok(release,'storage reached');
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);release();await pending;assert.deepEqual(await readdir(f.mapping.directory),[]);
});
test('lost durable reply retains original report and restart accepts exact replay',async t=>{
 const f=await fixture(t),collect=collector();let committed:unknown;
 await assert.rejects(collect(f.mapping,{async record(_m:TrafficMapping,e:unknown){committed=e;throw Error('private-database-canary');}}),refused);
 assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);
 await collect(f.mapping,{async record(_m:TrafficMapping,e:unknown){assert.deepEqual(e,committed);return receipt(f.report,'replay');}});
 assert.deepEqual(await readdir(f.mapping.directory),[]);
});
test('collector orders each process by numeric sequence and retains later reports after a refusal',async t=>{
 const f=await fixture(t),collect=collector();await rm(f.file);
 for(const sequence of [10,2,1])await f.put({...f.report,sequence});const seen:number[]=[];
 await assert.rejects(collect(f.mapping,{async record(_m:TrafficMapping,e:unknown){const r=JSON.parse(Buffer.from((e as {payload:string}).payload,'base64url').toString());seen.push(r.sequence);if(r.sequence===2)throw Error('retry');return receipt(r);}}),refused);
 assert.deepEqual(seen,[1,2]);assert.deepEqual((await readdir(f.mapping.directory)).sort(),[`${f.report.processId}.10.json`,`${f.report.processId}.2.json`]);
});
for(const fault of ['unknown-state','wrong-process','wrong-sequence','extra-field','missing'] as const)test(`collector retains report after ${fault} receipt`,async t=>{
 const f=await fixture(t),collect=collector();let answer:unknown=receipt(f.report);
 if(fault==='unknown-state')answer={...receipt(f.report),state:'queued'};
 if(fault==='wrong-process')answer={...receipt(f.report),processId:randomUUID()};
 if(fault==='wrong-sequence')answer={...receipt(f.report),sequence:2};
 if(fault==='extra-field')answer={...receipt(f.report),secret:'private-canary'};
 if(fault==='missing')answer=undefined;
 await assert.rejects(collect(f.mapping,{async record(){return answer;}}),refused);assert.equal(await readFile(f.file,'utf8').catch(()=>null),f.text);
});
for(const fault of ['file-mode','directory-mode','uid','gid','symlink','parent-symlink','hard-link','directory','fifo','oversize','malformed','invalid-utf8','wrong-filename-process','wrong-filename-sequence','unknown-name','unsafe-sequence','leading-zero','non-test','foreign-cell','traversal'] as const)test(`collector refuses ${fault} without storage or acknowledgement`,async t=>{
 const f=await fixture(t),collect=collector();let mapping={...f.mapping};
 if(fault==='file-mode')await chmod(f.file,0o644);
 if(fault==='directory-mode')await chmod(mapping.directory,0o750);
 if(fault==='uid')mapping.writerUid++;
 if(fault==='gid')mapping.readerGid++;
 if(fault==='symlink'){const held=f.mapping.directory+'-held';await rename(f.file,held);t.after(()=>rm(held));await symlink(held,f.file);}
 if(fault==='parent-symlink'){const alias=mapping.directory+'-alias';await symlink(dirname(mapping.directory),alias);t.after(()=>rm(alias));mapping.directory=join(alias,basename(mapping.directory));}
 if(fault==='hard-link'){const held=f.mapping.directory+'-held';await link(f.file,held);t.after(()=>rm(held));}
 if(fault==='directory'){await rm(f.file);await mkdir(f.file);}
 if(fault==='fifo'){await rm(f.file);execFileSync('mkfifo',['-m','640',f.file]);}
 if(fault==='oversize')await writeFile(f.file,f.text+' '.repeat(262145));
 if(fault==='malformed')await writeFile(f.file,'private-canary');
 if(fault==='invalid-utf8')await writeFile(f.file,Buffer.from([0xff]));
 if(fault==='wrong-filename-process')await rename(f.file,join(mapping.directory,`${randomUUID()}.1.json`));
 if(fault==='wrong-filename-sequence')await rename(f.file,join(mapping.directory,`${f.report.processId}.2.json`));
 if(fault==='unknown-name')await rename(f.file,join(mapping.directory,'private-canary.json'));
 if(fault==='unsafe-sequence')await rename(f.file,join(mapping.directory,`${f.report.processId}.9007199254740992.json`));
 if(fault==='leading-zero')await rename(f.file,join(mapping.directory,`${f.report.processId}.01.json`));
 if(fault==='non-test')mapping.environment='production' as 'test';
 if(fault==='foreign-cell')mapping.cellId=randomUUID();
 if(fault==='traversal')mapping.directory+='/../'+mapping.directory.split('/').at(-1);
 let calls=0;await assert.rejects(collect(mapping,{async record(){calls++;return receipt(f.report);}}),refused);assert.equal(calls,0);assert.notDeepEqual(await readdir(f.mapping.directory),[]);
});
test('collector refuses a replaced report after durable storage without deleting replacement',async t=>{
 const f=await fixture(t),collect=collector();
 await assert.rejects(collect(f.mapping,{async record(){await rename(f.file,f.file+'.held');await writeFile(f.file,'replacement',{mode:0o640});return receipt(f.report);}}),refused);
 assert.equal(await readFile(f.file,'utf8'),'replacement');assert.equal(await readFile(f.file+'.held','utf8'),f.text);
});
test('collector snapshots mapping before a delayed database reply',async t=>{
 const f=await fixture(t),collect=collector(),original={...f.mapping};
 await collect(f.mapping,{async record(m:TrafficMapping){assert.deepEqual(m,original);f.mapping.directory='/no-such-private-canary';f.mapping.cellId=randomUUID();return receipt(f.report);}});
 assert.deepEqual(await readdir(original.directory),[]);
});
test('collector refuses unbounded directory scans before storage',async t=>{
 const f=await fixture(t),collect=collector();for(let sequence=2;sequence<=4097;sequence++)await f.put({...f.report,sequence});
 let calls=0;await assert.rejects(collect(f.mapping,{async record(){calls++;return receipt(f.report);}}),refused);assert.equal(calls,0);assert.equal((await readdir(f.mapping.directory)).length,4097);
});

for(const scenario of ['directory-open','post-read','file-uid','file-gid','directory-uid','directory-gid'] as const)test(`collector refuses ${scenario} race before storage`,async t=>{
 const f=await fixture(t),collect=collector();assert.equal(typeof collect,'function');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/traffic-collector-race.ts',import.meta.url)),scenario,JSON.stringify(f.mapping)],{encoding:'utf8',timeout:5000});
 assert.equal(result.signal,null,'race control must terminate');assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.stdout,'refused without storage\n');
});
test('collector does not unlink a file changed in place during country storage',async t=>{
 const f=await fixture(t),collect=collector();
 await assert.rejects(collect(f.mapping,{async record(){await writeFile(f.file,'x'.repeat(Buffer.byteLength(f.text)));return receipt(f.report);}}),refused);
 assert.equal(await readFile(f.file,'utf8'),'x'.repeat(Buffer.byteLength(f.text)));
});
